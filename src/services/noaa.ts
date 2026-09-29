const BASE_URL = "https://api.tidesandcurrents.noaa.gov";

export interface CurrentStation {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface CurrentPrediction {
  time: Date;
  velocity: number; // knots, positive = flood, negative = ebb
  meanFloodDir: number;
  meanEbbDir: number;
}

interface StationResponse {
  stations: Array<{
    id: string;
    name: string;
    lat: number;
    lng: number;
  }>;
}

interface PredictionResponse {
  current_predictions: {
    cp: Array<{
      Time: string;
      Velocity_Major: number;
      meanFloodDir: number;
      meanEbbDir: number;
    }>;
  };
}

let stationCache: CurrentStation[] | null = null;

export async function fetchCurrentStations(): Promise<CurrentStation[]> {
  if (stationCache) return stationCache;

  const url = `${BASE_URL}/mdapi/prod/webapi/stations.json?type=currentpredictions&units=english`;
  const res = await fetch(url);
  const data: StationResponse = await res.json();

  stationCache = data.stations.map((s) => ({
    id: s.id,
    name: s.name,
    lat: s.lat,
    lng: s.lng,
  }));

  return stationCache;
}

/**
 * Predictions for 48h from `start` (an exact instant, e.g. local midnight in the
 * region's time zone). Requested and parsed in GMT so times are correct whatever
 * zone the station or the viewer is in.
 */
export async function fetchCurrentPredictions(
  stationId: string,
  start: Date,
): Promise<CurrentPrediction[]> {
  const url =
    `${BASE_URL}/api/prod/datagetter` +
    `?station=${stationId}` +
    `&product=currents_predictions` +
    `&begin_date=${encodeURIComponent(formatUtc(start))}` +
    // 48h so late departures (and the best-time sweep) still have data past midnight.
    `&range=48` +
    `&interval=6` +
    `&units=english` +
    `&time_zone=gmt` +
    `&format=json`;

  const res = await fetch(url);
  const data: PredictionResponse = await res.json();

  return data.current_predictions.cp.map((p) => ({
    // "2026-09-30 04:06" in GMT
    time: new Date(`${p.Time.replace(" ", "T")}Z`),
    velocity: p.Velocity_Major,
    meanFloodDir: p.meanFloodDir,
    meanEbbDir: p.meanEbbDir,
  }));
}

/** "yyyyMMdd HH:mm" in UTC, NOAA's begin_date format. */
function formatUtc(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())} ` +
    `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`
  );
}

/** Find the nearest current station to a given lat/lng */
export function findNearestStation(
  lat: number,
  lng: number,
  stations: CurrentStation[],
): CurrentStation {
  let best = stations[0];
  let bestDist = Infinity;

  for (const s of stations) {
    const d = haversineDistanceKm(lat, lng, s.lat, s.lng);
    if (d < bestDist) {
      bestDist = d;
      best = s;
    }
  }

  return best;
}

/** Find unique nearest stations for route segments, deduplicating */
export function findStationsForRoute(
  coords: number[][],
  stations: CurrentStation[],
): Map<string, CurrentStation> {
  const needed = new Map<string, CurrentStation>();

  for (let i = 0; i < coords.length - 1; i++) {
    const midLat = (coords[i][1] + coords[i + 1][1]) / 2;
    const midLng = (coords[i][0] + coords[i + 1][0]) / 2;
    const station = findNearestStation(midLat, midLng, stations);
    if (!needed.has(station.id)) {
      needed.set(station.id, station);
    }
  }

  return needed;
}

function haversineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371;
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
