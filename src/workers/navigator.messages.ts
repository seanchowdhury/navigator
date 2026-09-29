/** Messages between MapView and the routing worker. */

export type LatLng = { lat: number; lng: number };

export type WorkerRequest =
  /** Download (if needed) and parse a region's graph. */
  | {
      type: "loadRegion";
      regionId: string;
      url: string;
      /** Other water networks this size or larger are routable too (0 = largest only). */
      minComponentNodes: number;
    }
  | { type: "route"; requestId: number; regionId: string; from: LatLng; to: LatLng }
  /** The region's graph as JSON, for the dev-only graph editor. */
  | { type: "getGraph"; requestId: number; regionId: string };

export type WorkerResponse =
  /**
   * Sent once the worker's message handler is installed. The WASM import is
   * instantiated with a top-level await, and messages that arrive before the
   * handler exists are dropped, so the page must not post until it sees this.
   */
  | { type: "workerReady" }
  | { type: "regionProgress"; regionId: string; loaded: number; total: number | null }
  | { type: "regionReady"; regionId: string }
  | { type: "regionError"; regionId: string; message: string }
  /** coords is [lat, lng, lat, lng, ...], smoothed; distance in meters. */
  | { type: "route"; requestId: number; coords: number[]; distance: number }
  | { type: "routeError"; requestId: number; message: string }
  | { type: "graph"; requestId: number; json: string }
  | { type: "graphError"; requestId: number; message: string };
