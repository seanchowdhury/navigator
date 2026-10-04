export interface WindForecast {
  time: Date;
  speedKnots: number;
  directionDeg: number; // direction wind is coming FROM (meteorological convention)
  windDirectionLabel: string; // e.g. "NNE"
  temperatureF: number;
  shortForecast: string; // e.g. "Partly Cloudy"
  isDaytime: boolean;
}

/**
 * An emoji for an NWS shortForecast ("Mostly Sunny", "Chance Rain Showers",
 * "Patchy Fog", ...), or "" if nothing matches. Checks the most significant
 * weather first, so "Showers And Thunderstorms" is a storm, not rain.
 */
export function weatherEmoji(shortForecast: string, isDaytime = true): string {
  const f = shortForecast.toLowerCase();
  if (f.includes("thunder")) return "⛈️";
  if (/snow|flurr|blizzard|sleet|freezing|ice/.test(f)) return "🌨️";
  if (/rain|shower|drizzle/.test(f)) return /chance/.test(f) && isDaytime ? "🌦️" : "🌧️";
  if (/fog|haze|smoke|mist/.test(f)) return "🌫️";
  if (f.includes("partly")) return isDaytime ? "⛅" : "☁️";
  if (/mostly sunny|mostly clear/.test(f)) return isDaytime ? "🌤️" : "🌙";
  if (/cloudy|overcast/.test(f)) return "☁️";
  if (/sunny|clear|fair/.test(f)) return isDaytime ? "☀️" : "🌙";
  if (/wind|breez|blustery/.test(f)) return "💨";
  return "";
}

interface GridPointCache {
  office: string;
  gridX: number;
  gridY: number;
}

const gridCache: Map<string, GridPointCache> = new Map();

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

const forecastCache: Map<string, WindForecast[]> = new Map();

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
      isDaytime: boolean;
    }) => ({
      time: new Date(p.startTime),
      speedKnots: parseWindSpeed(p.windSpeed),
      directionDeg: compassToDegrees(p.windDirection),
      windDirectionLabel: p.windDirection,
      temperatureF: p.temperature,
      shortForecast: p.shortForecast,
      isDaytime: p.isDaytime ?? true,
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

const HOUR_MS = 3600_000;

/**
 * The hourly forecast covering `time`, or null if none does. The forecast runs
 * about a week ahead and has nothing for hours already past; a time outside it
 * gets no forecast rather than the nearest one.
 */
export function forecastAt(forecasts: WindForecast[], time: Date): WindForecast | null {
  const t = time.getTime();
  return forecasts.find((f) => f.time.getTime() <= t && t < f.time.getTime() + HOUR_MS) ?? null;
}

/** Why there's no forecast for a time. */
export type NoForecastReason = "beforeForecast" | "beyondForecast" | "failed";

/** Why `forecastAt` has nothing for `time`. `forecasts` is null if the request failed. */
export function noForecastReason(forecasts: WindForecast[] | null, time: Date): NoForecastReason {
  if (!forecasts || forecasts.length === 0) return "failed";
  return time.getTime() < forecasts[0].time.getTime() ? "beforeForecast" : "beyondForecast";
}

/** When the forecast runs out, or null if there isn't one. */
export function forecastEnd(forecasts: WindForecast[] | null): Date | null {
  const last = forecasts?.[forecasts.length - 1];
  return last ? new Date(last.time.getTime() + HOUR_MS) : null;
}

/** The forecast for the weather panel: the departure hour at the start of the route. */
export type Weather =
  | { status: "loading" }
  | { status: "ready"; forecast: WindForecast }
  | { status: "unavailable"; reason: NoForecastReason; forecastEnd: Date | null };
