export interface WindForecast {
  time: Date;
  speedKnots: number;
  directionDeg: number; // direction wind is coming FROM (meteorological convention)
  windDirectionLabel: string; // e.g. "NNE"
  temperatureF: number;
  shortForecast: string; // e.g. "Partly Cloudy"
}

interface GridPointCache {
  office: string;
  gridX: number;
  gridY: number;
}

let gridCache: Map<string, GridPointCache> = new Map();

function gridKey(lat: number, lng: number): string {
  // Round to ~10km grid to reuse lookups along a route
  return `${lat.toFixed(1)},${lng.toFixed(1)}`;
}

async function getGridPoint(lat: number, lng: number): Promise<GridPointCache> {
  const key = gridKey(lat, lng);
  if (gridCache.has(key)) return gridCache.get(key)!;

  const res = await fetch(
    `https://api.weather.gov/points/${lat.toFixed(4)},${lng.toFixed(4)}`,
    { headers: { "User-Agent": "navigator-app" } },
  );
  const data = await res.json();
  const grid: GridPointCache = {
    office: data.properties.gridId,
    gridX: data.properties.gridX,
    gridY: data.properties.gridY,
  };
  gridCache.set(key, grid);
  return grid;
}

let forecastCache: Map<string, WindForecast[]> = new Map();

export async function fetchWindForecast(
  lat: number,
  lng: number,
): Promise<WindForecast[]> {
  const grid = await getGridPoint(lat, lng);
  const cacheKey = `${grid.office}/${grid.gridX},${grid.gridY}`;
  if (forecastCache.has(cacheKey)) return forecastCache.get(cacheKey)!;

  const res = await fetch(
    `https://api.weather.gov/gridpoints/${grid.office}/${grid.gridX},${grid.gridY}/forecast/hourly`,
    { headers: { "User-Agent": "navigator-app" } },
  );
  const data = await res.json();

  const forecasts: WindForecast[] = data.properties.periods.map(
    (p: {
      startTime: string;
      windSpeed: string;
      windDirection: string;
      temperature: number;
      shortForecast: string;
    }) => ({
      time: new Date(p.startTime),
      speedKnots: parseWindSpeed(p.windSpeed),
      directionDeg: compassToDegrees(p.windDirection),
      windDirectionLabel: p.windDirection,
      temperatureF: p.temperature,
      shortForecast: p.shortForecast,
    }),
  );

  forecastCache.set(cacheKey, forecasts);
  return forecasts;
}

function parseWindSpeed(windStr: string): number {
  // NWS returns "15 mph" or "10 to 15 mph"
  const matches = windStr.match(/(\d+)/g);
  if (!matches) return 0;
  const mph =
    matches.length > 1
      ? (parseInt(matches[0]) + parseInt(matches[1])) / 2
      : parseInt(matches[0]);
  return mph * 0.868976; // mph to knots
}

function compassToDegrees(dir: string): number {
  const map: Record<string, number> = {
    N: 0, NNE: 22.5, NE: 45, ENE: 67.5,
    E: 90, ESE: 112.5, SE: 135, SSE: 157.5,
    S: 180, SSW: 202.5, SW: 225, WSW: 247.5,
    W: 270, WNW: 292.5, NW: 315, NNW: 337.5,
  };
  return map[dir] ?? 0;
}

export function interpolateWind(
  forecasts: WindForecast[],
  time: Date,
): WindForecast | null {
  if (forecasts.length === 0) return null;

  const t = time.getTime();
  // Hourly forecasts — find the one covering this time
  for (const f of forecasts) {
    if (f.time.getTime() <= t && t < f.time.getTime() + 3600_000) {
      return f;
    }
  }

  // Return nearest
  return forecasts.reduce((closest, f) =>
    Math.abs(f.time.getTime() - t) < Math.abs(closest.time.getTime() - t)
      ? f
      : closest,
  );
}
