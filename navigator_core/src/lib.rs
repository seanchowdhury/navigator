mod utils;

use navigator_common::Graph;
use ordered_float::OrderedFloat;
use wasm_bindgen::prelude::*;
use std::collections::BinaryHeap;
use std::cmp::Reverse;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);
}


/// The graph plus everything derived from it, built once and reused across calls.
struct Router {
    graph: Graph,
    adj: Vec<Vec<(u32, f32)>>,
    /// Nodes that clicks snap to: the largest connected component, plus any other
    /// component of at least `min_component_nodes`. Small fragments (graph
    /// artifacts, ponds) are skipped so a click near one still gets a route.
    snappable: Vec<usize>,
}

impl Router {
    fn new(graph: Graph, min_component_nodes: usize) -> Self {
        let mut adj: Vec<Vec<(u32, f32)>> = vec![vec![]; graph.nodes.len()];
        for edge in &graph.edges {
            adj[edge.from as usize].push((edge.to, edge.distance));
            adj[edge.to as usize].push((edge.from, edge.distance));
        }
        let mut components = connected_components(&adj);
        components.sort_by_key(|c| std::cmp::Reverse(c.len()));
        let snappable = components
            .into_iter()
            .enumerate()
            .filter(|(i, c)| *i == 0 || (min_component_nodes > 0 && c.len() >= min_component_nodes))
            .flat_map(|(_, c)| c)
            .collect();
        Router { graph, adj, snappable }
    }

    fn closest_node(&self, lat: f64, lng: f64) -> usize {
        let nodes = &self.graph.nodes;
        *self.snappable.iter()
            .min_by(|&&a, &&b| {
                let da = (nodes[a].lat - lat).powi(2) + (nodes[a].lng - lng).powi(2);
                let db = (nodes[b].lat - lat).powi(2) + (nodes[b].lng - lng).powi(2);
                da.partial_cmp(&db).unwrap()
            })
            .expect("graph has no nodes")
    }
}

/// Loaded regions by id. Graphs are downloaded by the page and handed over with
/// load_region, so the WASM itself carries no map data.
fn routers() -> &'static Mutex<HashMap<String, Router>> {
    static ROUTERS: OnceLock<Mutex<HashMap<String, Router>>> = OnceLock::new();
    ROUTERS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn load_region_impl(region_id: &str, bytes: &[u8], min_component_nodes: usize) -> Result<(), String> {
    let graph: Graph = bincode::deserialize(bytes)
        .map_err(|e| format!("Invalid graph for region '{}': {}", region_id, e))?;
    if graph.nodes.is_empty() {
        return Err(format!("Graph for region '{}' has no nodes", region_id));
    }
    let router = Router::new(graph, min_component_nodes);
    routers().lock().unwrap().insert(region_id.to_string(), router);
    Ok(())
}

fn with_router<T>(region_id: &str, f: impl FnOnce(&Router) -> T) -> Result<T, String> {
    let routers = routers().lock().unwrap();
    let router = routers
        .get(region_id)
        .ok_or_else(|| format!("Region '{}' is not loaded", region_id))?;
    Ok(f(router))
}

fn find_route_impl(
    region_id: &str,
    start_lat: f64,
    start_lng: f64,
    end_lat: f64,
    end_lng: f64,
) -> Result<Vec<f64>, String> {
    with_router(region_id, |router| {
        let graph = &router.graph;
        let closest_start = router.closest_node(start_lat, start_lng);
        let closest_end = router.closest_node(end_lat, end_lng);

        match astar(graph, &router.adj, closest_start, closest_end) {
            Some((path, total_distance)) => {
                let mut result: Vec<f64> = path.iter()
                    .flat_map(|&i| vec![graph.nodes[i].lat, graph.nodes[i].lng])
                    .collect();
                result.push(total_distance as f64);
                result
            }
            None => vec![],
        }
    })
}

/// Parses a region's graph (bincode, as written by navigator_offline) and keeps it
/// ready for routing. Loading an already-loaded region replaces it.
///
/// Clicks snap to the largest water network, plus any other network of at least
/// `min_component_nodes` nodes (0 = largest only). Routes between two different
/// networks come back empty.
#[wasm_bindgen]
pub fn load_region(region_id: &str, bytes: &[u8], min_component_nodes: u32) -> Result<(), JsError> {
    load_region_impl(region_id, bytes, min_component_nodes as usize).map_err(|e| JsError::new(&e))
}

#[wasm_bindgen]
pub fn unload_region(region_id: &str) {
    routers().lock().unwrap().remove(region_id);
}

/// Returns the node indices of each connected component.
fn connected_components(adj: &[Vec<(u32, f32)>]) -> Vec<Vec<usize>> {
    let mut visited = vec![false; adj.len()];
    let mut components: Vec<Vec<usize>> = vec![];
    for start in 0..adj.len() {
        if visited[start] { continue; }
        visited[start] = true;
        let mut component = vec![];
        let mut stack = vec![start];
        while let Some(u) = stack.pop() {
            component.push(u);
            for &(v, _) in &adj[u] {
                if !visited[v as usize] {
                    visited[v as usize] = true;
                    stack.push(v as usize);
                }
            }
        }
        components.push(component);
    }
    components
}

/// Returns a loaded region's waterway graph as JSON, for viewing/editing on the map.
#[wasm_bindgen]
pub fn get_graph(region_id: &str) -> Result<String, JsError> {
    with_router(region_id, |router| {
        serde_json::to_string(&router.graph).expect("Failed to serialize graph")
    })
    .map_err(|e| JsError::new(&e))
}

/// Route between two points in a loaded region: path as [lat, lng, lat, lng, ...]
/// followed by the path's length in meters. Empty if there is no route.
#[wasm_bindgen]
pub fn find_route(
    region_id: &str,
    start_lat: f64,
    start_lng: f64,
    end_lat: f64,
    end_lng: f64,
) -> Result<Vec<f64>, JsError> {
    find_route_impl(region_id, start_lat, start_lng, end_lat, end_lng).map_err(|e| JsError::new(&e))
}

/// Shore penalty weight: higher values push routes further from shore.
const SHORE_PENALTY: f32 = 50.0;
/// Shore distance (meters) below which the penalty kicks in.
const SHORE_THRESHOLD: f32 = 200.0;

fn haversine(lat1: f64, lng1: f64, lat2: f64, lng2: f64) -> f32 {
    let r = 6_371_000.0_f64; // Earth radius in meters
    let dlat = (lat2 - lat1).to_radians();
    let dlng = (lng2 - lng1).to_radians();
    let a = (dlat / 2.0).sin().powi(2)
        + lat1.to_radians().cos() * lat2.to_radians().cos() * (dlng / 2.0).sin().powi(2);
    (r * 2.0 * a.sqrt().asin()) as f32
}

fn astar(graph: &Graph, adj: &[Vec<(u32, f32)>], start: usize, end: usize) -> Option<(Vec<usize>, f32)> {
    let n = adj.len();
    let goal_lat = graph.nodes[end].lat;
    let goal_lng = graph.nodes[end].lng;

    // g_score is the search cost (distance + shore penalty); dist is the plain
    // geometric distance along the same path, which is what we report.
    let mut g_score = vec![f32::INFINITY; n];
    let mut dist = vec![f32::INFINITY; n];
    let mut prev = vec![usize::MAX; n];
    g_score[start] = 0.0;
    dist[start] = 0.0;

    let h_start = haversine(graph.nodes[start].lat, graph.nodes[start].lng, goal_lat, goal_lng);
    let mut heap = BinaryHeap::new();
    heap.push(Reverse((OrderedFloat(h_start), start)));

    while let Some(Reverse((_f, u))) = heap.pop() {
        if u == end { break; }
        let g_u = g_score[u];
        if g_u == f32::INFINITY { continue; }

        for &(v, w) in &adj[u] {
            let vi = v as usize;
            let sd = graph.nodes[vi].shore_distance;
            let penalty = if sd < SHORE_THRESHOLD {
                SHORE_PENALTY * (1.0 - sd / SHORE_THRESHOLD)
            } else {
                0.0
            };
            let tentative_g = g_u + w + penalty;
            if tentative_g < g_score[vi] {
                g_score[vi] = tentative_g;
                dist[vi] = dist[u] + w;
                prev[vi] = u;
                let h = haversine(graph.nodes[vi].lat, graph.nodes[vi].lng, goal_lat, goal_lng);
                heap.push(Reverse((OrderedFloat(tentative_g + h), vi)));
            }
        }
    }

    if g_score[end] == f32::INFINITY { return None; }
    let total_distance = dist[end];
    let mut path = vec![end];
    let mut cur = end;
    while cur != start {
        cur = prev[cur];
        path.push(cur);
    }
    path.reverse();
    Some((path, total_distance))
}

#[cfg(test)]
mod tests {
    use super::*;

    const NYC: &str = "nyc";

    /// Graphs as shipped, gzipped; the worker decompresses before load_region.
    fn gunzip(gz: &[u8]) -> Vec<u8> {
        use std::io::Read;
        let mut bytes = vec![];
        flate2::read::GzDecoder::new(gz).read_to_end(&mut bytes).unwrap();
        bytes
    }

    fn nyc_graph() -> Vec<u8> {
        gunzip(include_bytes!("../../src/assets/graphs/nyc.bin.gz"))
    }

    /// Seattle with its app settings (min_component_nodes: 150, for Green Lake).
    fn load_seattle() {
        let bytes = gunzip(include_bytes!("../../src/assets/graphs/seattle.bin.gz"));
        load_region_impl("seattle", &bytes, 150).unwrap();
    }

    fn seattle_route(from: (f64, f64), to: (f64, f64)) -> Vec<f64> {
        load_seattle();
        find_route_impl("seattle", from.0, from.1, to.0, to.1).unwrap()
    }

    const SHILSHOLE: (f64, f64) = (47.6800, -122.4150);
    const LAKE_WASHINGTON_MADISON_PARK: (f64, f64) = (47.6350, -122.2700);
    const LAKE_UNION: (f64, f64) = (47.6380, -122.3350);
    const GREEN_LAKE_NORTH: (f64, f64) = (47.6850, -122.3380);
    const GREEN_LAKE_SOUTH: (f64, f64) = (47.6760, -122.3310);
    const EAGLE_HARBOR: (f64, f64) = (47.6180, -122.5150);
    const ALKI: (f64, f64) = (47.5850, -122.4250);

    #[test]
    fn seattle_routes_through_the_ballard_locks() {
        let route = seattle_route(SHILSHOLE, LAKE_WASHINGTON_MADISON_PARK);
        assert!(route.len() > 4, "Shilshole to Lake Washington via the locks");
        // The route passes the locks (~47.6655, -122.3972).
        let coords = &route[..route.len() - 1];
        let near_locks = coords
            .chunks(2)
            .any(|p| haversine(p[0], p[1], 47.6655, -122.3972) < 300.0);
        assert!(near_locks, "route should go through the locks");
    }

    #[test]
    fn seattle_open_sound_is_routable() {
        // Only works if the coastline sea fill connected the Sound.
        assert!(seattle_route(ALKI, EAGLE_HARBOR).len() > 4, "Alki across to Eagle Harbor");
    }

    #[test]
    fn seattle_green_lake_is_its_own_network() {
        assert!(seattle_route(GREEN_LAKE_NORTH, GREEN_LAKE_SOUTH).len() > 2, "within Green Lake");
        assert!(seattle_route(GREEN_LAKE_NORTH, LAKE_UNION).is_empty(), "Green Lake to Lake Union: no water route");
    }

    /// NYC snaps to its largest network only (min_component_nodes = 0).
    fn load_nyc() {
        load_region_impl(NYC, &nyc_graph(), 0).unwrap();
    }

    fn find_route(start_lat: f64, start_lng: f64, end_lat: f64, end_lng: f64) -> Vec<f64> {
        load_nyc();
        find_route_impl(NYC, start_lat, start_lng, end_lat, end_lng).unwrap()
    }

    #[test]
    fn unknown_region_is_an_error() {
        assert!(find_route_impl("atlantis", 0.0, 0.0, 1.0, 1.0).is_err());
    }

    #[test]
    fn invalid_graph_bytes_are_an_error() {
        assert!(load_region_impl("broken", &[1, 2, 3], 0).is_err());
    }

    /// The reported distance must be the path's geometric length, not the
    /// A* cost (which includes the shore penalty).
    #[test]
    fn route_distance_excludes_shore_penalty() {
        // East River, Brooklyn Bridge to around E 34th St: narrow enough that the
        // shore penalty applies along most of the route.
        let result = find_route(40.7040, -73.9950, 40.7440, -73.9680);
        assert!(result.len() > 4, "expected a route");

        let (coords, distance) = result.split_at(result.len() - 1);
        let path_length: f32 = coords
            .chunks(2)
            .collect::<Vec<_>>()
            .windows(2)
            .map(|w| haversine(w[0][0], w[0][1], w[1][0], w[1][1]))
            .sum();

        let reported = distance[0] as f32;
        assert!(
            (reported - path_length).abs() / path_length < 0.01,
            "reported {} m, path is {} m",
            reported, path_length
        );
    }

    /// Clicking right on an isolated patch of water must still snap onto the
    /// main network and return a route.
    #[test]
    fn isolated_click_still_routes() {
        load_nyc();
        let routers = routers().lock().unwrap();
        let router = &routers[NYC];
        let mut in_main = vec![false; router.graph.nodes.len()];
        router.snappable.iter().for_each(|&i| in_main[i] = true);
        let isolated = (0..in_main.len())
            .find(|&i| !in_main[i])
            .expect("test assumes the graph has isolated nodes");
        let (lat, lng) = (router.graph.nodes[isolated].lat, router.graph.nodes[isolated].lng);
        drop(routers);

        let result = find_route(lat, lng, 40.7440, -73.9680);
        assert!(result.len() > 4, "expected a route from an isolated click");
    }

    /// With a threshold, sizeable separate networks (lakes) become snappable in
    /// their own right: routes within one work, routes between two come back empty.
    #[test]
    fn min_component_nodes_makes_separate_networks_routable() {
        // NYC's second network (524 nodes, south of the Narrows) with a 500-node threshold.
        load_region_impl("nyc-500", &nyc_graph(), 500).unwrap();
        let (a, b) = {
            let routers = routers().lock().unwrap();
            let router = &routers["nyc-500"];
            let mut components = connected_components(&router.adj);
            components.sort_by_key(|c| std::cmp::Reverse(c.len()));
            assert_eq!(components[1].len(), 524, "test assumes the 524-node network");
            let second = &components[1];
            let node = |i: usize| (router.graph.nodes[i].lat, router.graph.nodes[i].lng);
            (node(second[0]), node(second[second.len() - 1]))
        };

        let within = find_route_impl("nyc-500", a.0, a.1, b.0, b.1).unwrap();
        assert!(within.len() > 2, "route within the second network");

        // To the East River (main network): different networks, so no route.
        let across = find_route_impl("nyc-500", a.0, a.1, 40.7440, -73.9680).unwrap();
        assert!(across.is_empty(), "no route between separate networks");
    }
}
