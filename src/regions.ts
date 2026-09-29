// Each region's graph is a separate gzipped file (built by navigator_offline) that
// the worker downloads the first time the region is in view. `?url` makes Vite
// emit it with a content-hashed filename, so it can be cached indefinitely.
import nycGraphUrl from "./assets/graphs/nyc.bin.gz?url";
import seattleGraphUrl from "./assets/graphs/seattle.bin.gz?url";
import seattleData from "./assets/regions/seattle.json";

/** [lng, lat] vertices of a closed ring. */
export type Ring = [number, number][];

/** Water with no tidal current (lakes, water behind locks): current is zero there. */
export interface NonTidalArea {
  name: string;
  polygon: Ring;
}

/** A note shown when a route passes within radiusM of a point (e.g. locks). */
export interface RouteNote {
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
  message: string;
}

export interface Region {
  id: string;
  name: string;
  /** [west, south, east, north] of the region's graph. */
  bbox: [number, number, number, number];
  center: { lat: number; lng: number };
  zoom: number;
  /** IANA zone that departure times are entered and shown in. */
  timezone: string;
  graphUrl: string;
  /**
   * Water networks other than the largest are routable if at least this many
   * nodes (e.g. a separate lake). Omit to only route on the largest network.
   */
  minComponentNodes?: number;
  nonTidalAreas?: NonTidalArea[];
  routeNotes?: RouteNote[];
}

export const REGIONS: Region[] = [
  {
    id: "nyc",
    name: "New York City",
    bbox: [-74.128, 40.5777, -73.9081, 40.8841],
    center: { lat: 40.7292, lng: -74.0117 },
    zoom: 15,
    timezone: "America/New_York",
    graphUrl: nycGraphUrl,
  },
  {
    id: "seattle",
    name: "Seattle",
    bbox: [-122.6, 47.49, -122.19, 47.78],
    center: { lat: 47.635, lng: -122.37 },
    zoom: 12,
    timezone: "America/Los_Angeles",
    graphUrl: seattleGraphUrl,
    // Green Lake is its own network (~185 nodes at 75m spacing).
    minComponentNodes: 150,
    nonTidalAreas: seattleData.nonTidalAreas as NonTidalArea[],
    routeNotes: seattleData.routeNotes,
  },
];

export const DEFAULT_REGION = REGIONS[0];

export function regionById(id: string): Region | undefined {
  return REGIONS.find((r) => r.id === id);
}

/** The region whose bbox contains the point, if any. */
export function regionAt(lat: number, lng: number): Region | undefined {
  return REGIONS.find(({ bbox: [west, south, east, north] }) =>
    lng >= west && lng <= east && lat >= south && lat <= north,
  );
}

/** Regions whose bbox overlaps the given [west, south, east, north] box. */
export function regionsInBounds([west, south, east, north]: [number, number, number, number]): Region[] {
  return REGIONS.filter(
    ({ bbox: [rw, rs, re, rn] }) => rw <= east && re >= west && rs <= north && rn >= south,
  );
}

/** Even-odd point-in-polygon test on a [lng, lat] ring. */
export function pointInRing(lng: number, lat: number, ring: Ring): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** The non-tidal area containing the point, if any. */
export function nonTidalAreaAt(
  areas: NonTidalArea[] | undefined,
  lat: number,
  lng: number,
): NonTidalArea | undefined {
  return areas?.find((area) => pointInRing(lng, lat, area.polygon));
}
