import {
  CurrentPrediction,
  CurrentStation,
  fetchCurrentPredictions,
  fetchCurrentStations,
  findNearestStation,
} from "./noaa";
import { fetchWindForecast, interpolateWind, WindForecast } from "./nws";
import { NonTidalArea, nonTidalAreaAt } from "../regions";

export type VesselType = "kayak" | "scull" | "whitehall_gig";

export const VESSEL_LABELS: Record<VesselType, string> = {
  kayak: "Kayak",
  scull: "Scull",
  whitehall_gig: "Whitehall Gig",
};

/** Wind drag coefficients — fraction of wind speed that affects boat speed */
const WIND_DRAG: Record<VesselType, number> = {
  kayak: 0.03,
  scull: 0.04,
  whitehall_gig: 0.05,
};

export interface TidalSegment {
  from: number[];
  to: number[];
  distanceNm: number;
  bearingDeg: number;
  currentSpeed: number;
  windEffect: number;
  effectiveSpeed: number;
  /** Boat speed + current + wind, before clamping. Negative means pushed backwards. */
  netSpeed: number;
  /** True when netSpeed is below STALL_THRESHOLD_KNOTS, so durationHours is not realistic. */
  stalled: boolean;
  durationHours: number;
  stationName: string;
  /** Estimated time the crew starts this segment. */
  startTime: Date;
}

/** Net speeds below this are clamped, so the segment's timing can't be trusted. */
export const STALL_THRESHOLD_KNOTS = 0.5;

export interface TidalRouteResult {
  segments: TidalSegment[];
  totalDurationHours: number;
  totalDurationWithoutEffects: number;
  tideDeltaMinutes: number;
  windDeltaMinutes: number;
  /** Route length (nm) the timings are based on, including the return leg. */
  totalDistanceNm: number;
  /** Time spent rowing; totalDurationHours = movingHours + stopHours. */
  movingHours: number;
  stopHours: number;
  /** Arrival at every waypoint after the start, in trip order (out, then back). */
  itinerary: ItineraryStop[];
  /** Segments where current (and wind) outrun the boat, in route order. */
  stalls: TidalSegment[];
}

export interface ItineraryStop {
  waypointIndex: number;
  direction: "out" | "back";
  arrival: Date;
  stopMinutes: number;
  /** arrival + stopMinutes. */
  departure: Date;
  /** A stall earlier in the trip makes these times lower bounds. */
  lowerBound: boolean;
}

/** Everything about the trip's shape other than speed, vessel and departure time. */
export interface TripOptions {
  roundTrip: boolean;
  /**
   * Stop (minutes) at each waypoint on the way out, indexed by waypoint. On a round
   * trip the last waypoint's value is the turnaround stop; on a one-way trip it's ignored.
   */
  stopMinutes: number[];
  /** Stop (minutes) at each waypoint on the way back. Round trips only. */
  returnStopMinutes: number[];
}

export const ONE_WAY_NO_STOPS: TripOptions = {
  roundTrip: false,
  stopMinutes: [],
  returnStopMinutes: [],
};

/** Cached data from API fetches — can be reused for recomputes */
export interface TidalRouteCache {
  simplified: number[][];
  /** Index into `simplified` of each waypoint, in waypoint order. */
  waypointVertices: number[];
  /** Length (nm) of the full route between each pair of simplified points. */
  segmentDistancesNm: number[];
  stations: CurrentStation[];
  predictions: Map<string, CurrentPrediction[]>;
  windForecasts: WindForecast[];
  /**
   * Per segment (outbound order): the name of the non-tidal area its midpoint is
   * in (a lake: no current), or null for tidal water.
   */
  segmentNonTidalAreas: (string | null)[];
}

/**
 * Fetch and cache tidal/wind data for a route and date.
 * Only call this when the route coords or date changes.
 */
export async function fetchTidalData(
  routeCoords: number[][],
  /** Start of the 48h prediction window (local midnight of the departure date). */
  date: Date,
  /** Index into routeCoords of each waypoint. Defaults to just the two ends. */
  waypointCoordIndices: number[] = [0, routeCoords.length - 1],
  /** Lakes etc. in the region; segments in them get no current. */
  nonTidalAreas: NonTidalArea[] = [],
): Promise<TidalRouteCache> {
  const stations = await fetchCurrentStations();
  const { keptIndices, waypointVertices } = simplifyByStretch(routeCoords, waypointCoordIndices, 20);
  const simplified = keptIndices.map((i) => routeCoords[i]);
  const segmentDistancesNm = keptIndices
    .slice(1)
    .map((end, k) => pathLengthNm(routeCoords, keptIndices[k], end));
  const segmentNonTidalAreas = simplified.slice(1).map((to, i) => {
    const [fromLng, fromLat] = simplified[i];
    return nonTidalAreaAt(nonTidalAreas, (fromLat + to[1]) / 2, (fromLng + to[0]) / 2)?.name ?? null;
  });
  // Only tidal segments need current predictions.
  const neededStations = new Map<string, CurrentStation>();
  simplified.slice(1).forEach((to, i) => {
    if (segmentNonTidalAreas[i]) return;
    const [fromLng, fromLat] = simplified[i];
    const station = findNearestStation((fromLat + to[1]) / 2, (fromLng + to[0]) / 2, stations);
    neededStations.set(station.id, station);
  });
  const predictions = new Map<string, CurrentPrediction[]>();

  const midIdx = Math.floor(simplified.length / 2);
  const windLat = simplified[midIdx][1];
  const windLng = simplified[midIdx][0];

  const [, windForecasts] = await Promise.all([
    Promise.all(
      Array.from(neededStations.entries()).map(async ([id]) => {
        const preds = await fetchCurrentPredictions(id, date);
        predictions.set(id, preds);
      }),
    ),
    fetchWindForecast(windLat, windLng).catch((): WindForecast[] => []),
  ]);

  return {
    simplified,
    waypointVertices,
    segmentDistancesNm,
    stations,
    predictions,
    windForecasts,
    segmentNonTidalAreas,
  };
}

/**
 * Recompute route timing from cached data.
 * Pure math — no API calls. Call this when time, speed, or vessel changes.
 */
export function recomputeTidalRoute(
  cache: TidalRouteCache,
  departureTime: Date,
  vesselSpeedKnots: number,
  vesselType: VesselType = "whitehall_gig",
  trip: TripOptions = ONE_WAY_NO_STOPS,
): TidalRouteResult {
  const {
    simplified,
    waypointVertices,
    segmentDistancesNm,
    stations,
    predictions,
    windForecasts,
    segmentNonTidalAreas,
  } = cache;
  const lastWaypoint = waypointVertices.length - 1;
  // Usually one waypoint per vertex, but two waypoints can snap to the same node.
  const waypointsAtVertex = new Map<number, number[]>();
  waypointVertices.forEach((vertex, w) => {
    waypointsAtVertex.set(vertex, [...(waypointsAtVertex.get(vertex) ?? []), w]);
  });

  // Outbound legs, then (for a round trip) the same legs back in reverse.
  type Leg = {
    from: number[];
    to: number[];
    distanceNm: number;
    direction: "out" | "back";
    endWaypoints: number[];
    /** Set for legs in a lake etc.: no current. */
    nonTidalArea: string | null;
  };
  const legs: Leg[] = simplified.slice(1).map((to, i) => ({
    from: simplified[i],
    to,
    distanceNm: segmentDistancesNm[i],
    direction: "out",
    nonTidalArea: segmentNonTidalAreas[i],
    // Skip waypoint 0 when it shares the first vertex; it's the start, not an arrival.
    endWaypoints: (waypointsAtVertex.get(i + 1) ?? []).filter((w) => w > 0),
  }));
  if (trip.roundTrip) {
    for (let i = simplified.length - 2; i >= 0; i--) {
      legs.push({
        from: simplified[i + 1],
        to: simplified[i],
        distanceNm: segmentDistancesNm[i],
        direction: "back",
        nonTidalArea: segmentNonTidalAreas[i],
        endWaypoints: [...(waypointsAtVertex.get(i) ?? [])].reverse(),
      });
    }
  }

  const stopAt = (w: number, direction: "out" | "back") => {
    let minutes = 0;
    if (direction === "out") {
      // Arriving at the last waypoint ends a one-way trip; on a round trip it's the turnaround.
      if (w < lastWaypoint || trip.roundTrip) minutes = trip.stopMinutes[w] ?? 0;
    } else if (w > 0) {
      minutes = trip.returnStopMinutes[w] ?? 0;
    }
    return Number.isFinite(minutes) ? Math.max(0, minutes) : 0;
  };

  const segments: TidalSegment[] = [];
  const itinerary: ItineraryStop[] = [];
  let currentTime = departureTime.getTime();
  let totalWithoutEffects = 0;
  let tideOnlyDelta = 0;
  let stopHours = 0;
  let stalledSoFar = false;

  for (const { from, to, distanceNm, direction, endWaypoints, nonTidalArea } of legs) {
    // Bearing uses the straight chord; distance follows the actual route.
    const segmentBearing = bearing(from[1], from[0], to[1], to[0]);

    const midLat = (from[1] + to[1]) / 2;
    const midLng = (from[0] + to[0]) / 2;
    // Lakes have no tidal current, so they don't use a station at all.
    const station = nonTidalArea ? null : findNearestStation(midLat, midLng, stations);

    const stationPreds = station ? predictions.get(station.id) : undefined;
    const currentAtTime = stationPreds
      ? interpolatePrediction(stationPreds, new Date(currentTime))
      : null;

    let currentComponent = 0;
    if (currentAtTime) {
      const currentDir =
        currentAtTime.velocity >= 0
          ? currentAtTime.meanFloodDir
          : currentAtTime.meanEbbDir;
      const currentSpeed = Math.abs(currentAtTime.velocity);
      const angleDiff = toRad(currentDir - segmentBearing);
      currentComponent = currentSpeed * Math.cos(angleDiff);
    }

    let windEffect = 0;
    const wind = interpolateWind(windForecasts, new Date(currentTime));
    if (wind) {
      const windPushDir = (wind.directionDeg + 180) % 360;
      const windAngleDiff = toRad(windPushDir - segmentBearing);
      windEffect = wind.speedKnots * WIND_DRAG[vesselType] * Math.cos(windAngleDiff);
    }

    const netSpeed = vesselSpeedKnots + currentComponent + windEffect;
    const effectiveSpeed = Math.max(STALL_THRESHOLD_KNOTS, netSpeed);
    const tideOnlySpeed = Math.max(STALL_THRESHOLD_KNOTS, vesselSpeedKnots + currentComponent);
    const durationHours = distanceNm / effectiveSpeed;
    const baseDuration = distanceNm / vesselSpeedKnots;
    const tideOnlyDuration = distanceNm / tideOnlySpeed;
    totalWithoutEffects += baseDuration;
    tideOnlyDelta += tideOnlyDuration - baseDuration;

    const stalled = netSpeed < STALL_THRESHOLD_KNOTS;
    stalledSoFar ||= stalled;
    segments.push({
      from,
      to,
      distanceNm,
      bearingDeg: segmentBearing,
      currentSpeed: currentComponent,
      windEffect,
      effectiveSpeed,
      netSpeed,
      stalled,
      durationHours,
      // On a lake there's no station; name the lake instead (a stall there is wind).
      stationName: station?.name ?? nonTidalArea ?? "",
      startTime: new Date(currentTime),
    });

    currentTime += durationHours * 3600 * 1000;

    for (const endWaypoint of endWaypoints) {
      const stopMinutes = stopAt(endWaypoint, direction);
      const arrival = new Date(currentTime);
      currentTime += stopMinutes * 60 * 1000;
      stopHours += stopMinutes / 60;
      itinerary.push({
        waypointIndex: endWaypoint,
        direction,
        arrival,
        stopMinutes,
        departure: new Date(currentTime),
        lowerBound: stalledSoFar,
      });
    }
  }

  const movingHours = sumHours(segments);
  // Tide/wind effects compare moving time only; stops aren't an "effect".
  const totalDelta = movingHours - totalWithoutEffects;
  const tideDeltaMinutes = tideOnlyDelta * 60;
  const windDeltaMinutes = (totalDelta - tideOnlyDelta) * 60;

  return {
    segments,
    totalDurationHours: movingHours + stopHours,
    totalDurationWithoutEffects: totalWithoutEffects,
    tideDeltaMinutes,
    windDeltaMinutes,
    totalDistanceNm: segments.reduce((sum, s) => sum + s.distanceNm, 0),
    movingHours,
    stopHours,
    itinerary,
    stalls: segments.filter((s) => s.stalled),
  };
}

export interface DepartureOption {
  departure: Date;
  durationHours: number;
  /** Some leg can't make headway, so durationHours is only a lower bound. */
  stalled: boolean;
}

export interface DepartureSweep {
  options: DepartureOption[];
  /** Fastest departure with no stalled legs. */
  best: DepartureOption | null;
  /** Contiguous departures around `best` within the tolerance of its duration. */
  bestWindow: { start: Date; end: Date } | null;
}

/**
 * Evaluates every departure between windowStart and windowEnd (inclusive) in
 * stepMinutes increments. Pure math over cached data, so it's cheap to rerun.
 */
export function sweepDepartures(
  cache: TidalRouteCache,
  windowStart: Date,
  windowEnd: Date,
  vesselSpeedKnots: number,
  vesselType: VesselType,
  trip: TripOptions,
  stepMinutes = 15,
  toleranceMinutes = 5,
): DepartureSweep {
  const options: DepartureOption[] = [];
  const stepMs = stepMinutes * 60 * 1000;
  for (let t = windowStart.getTime(); t <= windowEnd.getTime(); t += stepMs) {
    const departure = new Date(t);
    const result = recomputeTidalRoute(cache, departure, vesselSpeedKnots, vesselType, trip);
    options.push({
      departure,
      durationHours: result.totalDurationHours,
      stalled: result.stalls.length > 0,
    });
  }

  let bestIndex = -1;
  options.forEach((option, i) => {
    if (option.stalled) return;
    if (bestIndex === -1 || option.durationHours < options[bestIndex].durationHours) {
      bestIndex = i;
    }
  });
  if (bestIndex === -1) return { options, best: null, bestWindow: null };

  const best = options[bestIndex];
  const limit = best.durationHours + toleranceMinutes / 60;
  const withinTolerance = (o: DepartureOption) => !o.stalled && o.durationHours <= limit;
  let first = bestIndex;
  let last = bestIndex;
  while (first > 0 && withinTolerance(options[first - 1])) first--;
  while (last < options.length - 1 && withinTolerance(options[last + 1])) last++;

  return {
    options,
    best,
    bestWindow: { start: options[first].departure, end: options[last].departure },
  };
}

function sumHours(segments: TidalSegment[]): number {
  return segments.reduce((sum, s) => sum + s.durationHours, 0);
}

/** Returns the indices of the route points kept as segment endpoints. */
function simplifyRoute(coords: number[][], maxSegments: number): number[] {
  if (coords.length <= maxSegments + 1) return coords.map((_, i) => i);

  const step = Math.floor(coords.length / maxSegments);
  const result: number[] = [];
  for (let i = 0; i < coords.length - 1; i += step) {
    result.push(i);
  }
  result.push(coords.length - 1);
  return result;
}

/**
 * Simplifies each waypoint-to-waypoint stretch separately so every waypoint is kept
 * as a segment endpoint. The segment budget is shared out by stretch length (each
 * stretch gets at least one segment).
 */
function simplifyByStretch(
  coords: number[][],
  waypointCoordIndices: number[],
  maxSegments: number,
): { keptIndices: number[]; waypointVertices: number[] } {
  const totalPoints = Math.max(coords.length - 1, 1);
  const keptIndices = [waypointCoordIndices[0]];
  const waypointVertices = [0];
  for (let w = 1; w < waypointCoordIndices.length; w++) {
    const start = waypointCoordIndices[w - 1];
    const end = waypointCoordIndices[w];
    const stretch = coords.slice(start, end + 1);
    const budget = Math.max(1, Math.round((maxSegments * (end - start)) / totalPoints));
    // Skip the stretch's first point; it's the previous stretch's last.
    simplifyRoute(stretch, budget)
      .slice(1)
      .forEach((i) => keptIndices.push(start + i));
    waypointVertices.push(keptIndices.length - 1);
  }
  return { keptIndices, waypointVertices };
}

/** Length (nm) of the route polyline from coords[start] to coords[end]. */
function pathLengthNm(coords: number[][], start: number, end: number): number {
  let total = 0;
  for (let i = start; i < end; i++) {
    total += haversineNm(coords[i][1], coords[i][0], coords[i + 1][1], coords[i + 1][0]);
  }
  return total;
}

function interpolatePrediction(
  predictions: CurrentPrediction[],
  time: Date,
): CurrentPrediction | null {
  if (predictions.length === 0) return null;

  const t = time.getTime();

  let before: CurrentPrediction | null = null;
  let after: CurrentPrediction | null = null;

  for (let i = 0; i < predictions.length - 1; i++) {
    if (predictions[i].time.getTime() <= t && predictions[i + 1].time.getTime() >= t) {
      before = predictions[i];
      after = predictions[i + 1];
      break;
    }
  }

  if (!before || !after) {
    return predictions.reduce((closest, p) =>
      Math.abs(p.time.getTime() - t) < Math.abs(closest.time.getTime() - t)
        ? p
        : closest,
    );
  }

  const range = after.time.getTime() - before.time.getTime();
  const frac = (t - before.time.getTime()) / range;
  const velocity = before.velocity + frac * (after.velocity - before.velocity);

  return {
    time,
    velocity,
    meanFloodDir: before.meanFloodDir,
    meanEbbDir: before.meanEbbDir,
  };
}

function bearing(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLng = toRad(lng2 - lng1);
  const y = Math.sin(dLng) * Math.cos(toRad(lat2));
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLng);
  return ((toDeg(Math.atan2(y, x)) + 360) % 360);
}

function haversineNm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 3440.065;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}
