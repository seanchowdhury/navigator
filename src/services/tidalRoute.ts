import {
  CurrentPrediction,
  fetchCurrentPredictions,
  fetchCurrentStations,
  findNearestStation,
  findStationsForRoute,
} from "./noaa";

export interface TidalSegment {
  from: number[];
  to: number[];
  distanceNm: number;
  bearingDeg: number;
  currentSpeed: number; // knots, component along segment direction
  effectiveSpeed: number; // vessel speed adjusted by current
  durationHours: number;
  stationName: string;
}

export interface TidalRouteResult {
  segments: TidalSegment[];
  totalDurationHours: number;
  totalDurationWithoutTide: number;
  tideDeltaMinutes: number;
}

/**
 * Calculate how tidal currents affect travel time along a route.
 *
 * For each segment, finds the nearest NOAA current station,
 * gets the predicted current at the time the vessel reaches that segment,
 * and projects the current vector onto the segment bearing to determine
 * how much it helps or hinders.
 */
export async function calculateTidalRoute(
  routeCoords: number[][], // [lng, lat][] from the route
  departureTime: Date,
  vesselSpeedKnots: number,
): Promise<TidalRouteResult> {
  const stations = await fetchCurrentStations();

  // Simplify route to reduce API calls — sample every N points
  const simplified = simplifyRoute(routeCoords, 20);

  // Find unique stations needed and fetch predictions in parallel
  const neededStations = findStationsForRoute(simplified, stations);
  const predictions = new Map<string, CurrentPrediction[]>();

  await Promise.all(
    Array.from(neededStations.entries()).map(async ([id]) => {
      const preds = await fetchCurrentPredictions(id, departureTime);
      predictions.set(id, preds);
    }),
  );

  const segments: TidalSegment[] = [];
  let currentTime = departureTime.getTime();
  let totalWithoutTide = 0;

  for (let i = 0; i < simplified.length - 1; i++) {
    const from = simplified[i];
    const to = simplified[i + 1];

    const segmentBearing = bearing(from[1], from[0], to[1], to[0]);
    const distanceNm = haversineNm(from[1], from[0], to[1], to[0]);

    // Find nearest station for this segment's midpoint
    const midLat = (from[1] + to[1]) / 2;
    const midLng = (from[0] + to[0]) / 2;
    const station = findNearestStation(midLat, midLng, stations);

    // Get current prediction at the time vessel reaches this segment
    const stationPreds = predictions.get(station.id);
    const currentAtTime = stationPreds
      ? interpolatePrediction(stationPreds, new Date(currentTime))
      : null;

    // Project current onto segment direction
    let currentComponent = 0;
    if (currentAtTime) {
      const currentDir =
        currentAtTime.velocity >= 0
          ? currentAtTime.meanFloodDir
          : currentAtTime.meanEbbDir;
      const currentSpeed = Math.abs(currentAtTime.velocity);

      // Component of current along our direction of travel
      // Positive = helping, negative = hindering
      const angleDiff = toRad(currentDir - segmentBearing);
      currentComponent = currentSpeed * Math.cos(angleDiff);
    }

    const effectiveSpeed = Math.max(0.5, vesselSpeedKnots + currentComponent);
    const durationHours = distanceNm / effectiveSpeed;
    const durationWithoutTide = distanceNm / vesselSpeedKnots;
    totalWithoutTide += durationWithoutTide;

    segments.push({
      from,
      to,
      distanceNm,
      bearingDeg: segmentBearing,
      currentSpeed: currentComponent,
      effectiveSpeed,
      durationHours,
      stationName: station.name,
    });

    currentTime += durationHours * 3600 * 1000;
  }

  const totalDurationHours = segments.reduce(
    (sum, s) => sum + s.durationHours,
    0,
  );
  const tideDeltaMinutes = (totalDurationHours - totalWithoutTide) * 60;

  return {
    segments,
    totalDurationHours,
    totalDurationWithoutTide: totalWithoutTide,
    tideDeltaMinutes,
  };
}

/** Sample every nth point from the route, always keeping first and last */
function simplifyRoute(coords: number[][], maxSegments: number): number[][] {
  if (coords.length <= maxSegments + 1) return coords;

  const step = Math.floor(coords.length / maxSegments);
  const result: number[][] = [];
  for (let i = 0; i < coords.length - 1; i += step) {
    result.push(coords[i]);
  }
  result.push(coords[coords.length - 1]);
  return result;
}

function interpolatePrediction(
  predictions: CurrentPrediction[],
  time: Date,
): CurrentPrediction | null {
  if (predictions.length === 0) return null;

  const t = time.getTime();

  // Find the two predictions bracketing the requested time
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
    // Outside prediction range — use nearest
    return predictions.reduce((closest, p) =>
      Math.abs(p.time.getTime() - t) < Math.abs(closest.time.getTime() - t)
        ? p
        : closest,
    );
  }

  // Linear interpolation of velocity
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
  const R = 3440.065; // Earth radius in nautical miles
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
