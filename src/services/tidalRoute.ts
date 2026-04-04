import {
  CurrentPrediction,
  CurrentStation,
  fetchCurrentPredictions,
  fetchCurrentStations,
  findNearestStation,
  findStationsForRoute,
} from "./noaa";
import { fetchWindForecast, interpolateWind, WindForecast } from "./nws";

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
  durationHours: number;
  stationName: string;
}

export interface TidalRouteResult {
  segments: TidalSegment[];
  totalDurationHours: number;
  totalDurationWithoutEffects: number;
  tideDeltaMinutes: number;
  windDeltaMinutes: number;
}

/** Cached data from API fetches — can be reused for recomputes */
export interface TidalRouteCache {
  simplified: number[][];
  stations: CurrentStation[];
  predictions: Map<string, CurrentPrediction[]>;
  windForecasts: WindForecast[];
}

/**
 * Fetch and cache tidal/wind data for a route and date.
 * Only call this when the route coords or date changes.
 */
export async function fetchTidalData(
  routeCoords: number[][],
  date: Date,
): Promise<TidalRouteCache> {
  const stations = await fetchCurrentStations();
  const simplified = simplifyRoute(routeCoords, 20);
  const neededStations = findStationsForRoute(simplified, stations);
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

  return { simplified, stations, predictions, windForecasts };
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
): TidalRouteResult {
  const { simplified, stations, predictions, windForecasts } = cache;

  const segments: TidalSegment[] = [];
  let currentTime = departureTime.getTime();
  let totalWithoutEffects = 0;
  let tideOnlyDelta = 0;

  for (let i = 0; i < simplified.length - 1; i++) {
    const from = simplified[i];
    const to = simplified[i + 1];

    const segmentBearing = bearing(from[1], from[0], to[1], to[0]);
    const distanceNm = haversineNm(from[1], from[0], to[1], to[0]);

    const midLat = (from[1] + to[1]) / 2;
    const midLng = (from[0] + to[0]) / 2;
    const station = findNearestStation(midLat, midLng, stations);

    const stationPreds = predictions.get(station.id);
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

    const effectiveSpeed = Math.max(0.5, vesselSpeedKnots + currentComponent + windEffect);
    const tideOnlySpeed = Math.max(0.5, vesselSpeedKnots + currentComponent);
    const durationHours = distanceNm / effectiveSpeed;
    const baseDuration = distanceNm / vesselSpeedKnots;
    const tideOnlyDuration = distanceNm / tideOnlySpeed;
    totalWithoutEffects += baseDuration;
    tideOnlyDelta += tideOnlyDuration - baseDuration;

    segments.push({
      from,
      to,
      distanceNm,
      bearingDeg: segmentBearing,
      currentSpeed: currentComponent,
      windEffect,
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
  const totalDelta = totalDurationHours - totalWithoutEffects;
  const tideDeltaMinutes = tideOnlyDelta * 60;
  const windDeltaMinutes = (totalDelta - tideOnlyDelta) * 60;

  return {
    segments,
    totalDurationHours,
    totalDurationWithoutEffects: totalWithoutEffects,
    tideDeltaMinutes,
    windDeltaMinutes,
  };
}

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
