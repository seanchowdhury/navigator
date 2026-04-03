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

export async function fetchCurrentPredictions(
  stationId: string,
  date: Date,
): Promise<CurrentPrediction[]> {
  const dateStr = formatDate(date);
  const url =
    `${BASE_URL}/api/prod/datagetter` +
    `?station=${stationId}` +
    `&product=currents_predictions` +
    `&begin_date=${dateStr}` +
    `&range=24` +
    `&interval=6` +
    `&units=english` +
    `&time_zone=lst_ldt` +
    `&format=json`;

  const res = await fetch(url);
  const data: PredictionResponse = await res.json();

  return data.current_predictions.cp.map((p) => ({
    time: new Date(p.Time),
    velocity: p.Velocity_Major,
    meanFloodDir: p.meanFloodDir,
    meanEbbDir: p.meanEbbDir,
  }));
}

function formatDate(d: Date): string {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}${mm}${dd}`;
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
