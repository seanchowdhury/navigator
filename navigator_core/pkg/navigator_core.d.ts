/* tslint:disable */
/* eslint-disable */

/**
 * Route between two points in a loaded region: path as [lat, lng, lat, lng, ...]
 * followed by the path's length in meters. Empty if there is no route.
 */
export function find_route(region_id: string, start_lat: number, start_lng: number, end_lat: number, end_lng: number): Float64Array;

/**
 * Returns a loaded region's waterway graph as JSON, for viewing/editing on the map.
 */
export function get_graph(region_id: string): string;

/**
 * Parses a region's graph (bincode, as written by navigator_offline) and keeps it
 * ready for routing. Loading an already-loaded region replaces it.
 *
 * Clicks snap to the largest water network, plus any other network of at least
 * `min_component_nodes` nodes (0 = largest only). Routes between two different
 * networks come back empty.
 */
export function load_region(region_id: string, bytes: Uint8Array, min_component_nodes: number): void;

export function unload_region(region_id: string): void;
