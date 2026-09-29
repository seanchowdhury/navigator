mod utils;

use navigator_common::Graph;
use ordered_float::OrderedFloat;
use wasm_bindgen::prelude::*;
use std::collections::BinaryHeap;
use std::cmp::Reverse;

#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);
}

fn load_graph() -> Graph {
    let data = include_bytes!("../graph.bin");
    bincode::deserialize(data).expect("Failed to deserialize graph")
}

/// Returns the embedded waterway graph as JSON, for viewing/editing on the map.
#[wasm_bindgen]
pub fn get_graph() -> String {
    let graph = load_graph();
    serde_json::to_string(&graph).expect("Failed to serialize graph")
}

#[wasm_bindgen]
pub fn find_route(start_lat: f64, start_lng: f64, end_lat: f64, end_lng: f64) -> Vec<f64> {
    let graph = load_graph();

    let mut adj: Vec<Vec<(u32, f32)>> = vec![vec![]; graph.nodes.len()];
    for edge in &graph.edges {
        adj[edge.from as usize].push((edge.to, edge.distance));
        adj[edge.to as usize].push((edge.from, edge.distance));
    }

    let closest_start = closest_node(&graph, start_lat, start_lng);
    let closest_end = closest_node(&graph, end_lat, end_lng);

    match astar(&graph, &adj, closest_start, closest_end) {
        Some((path, total_distance)) => {
            let mut result: Vec<f64> = path.iter()
                .flat_map(|&i| vec![graph.nodes[i].lat, graph.nodes[i].lng])
                .collect();
            result.push(total_distance as f64);
            result
        }
        None => vec![],
    }
}

fn closest_node(graph: &Graph, lat: f64, lng: f64) -> usize {
    graph.nodes.iter()
        .enumerate()
        .min_by(|(_, a), (_, b)| {
            let da = (a.lat - lat).powi(2) + (a.lng - lng).powi(2);
            let db = (b.lat - lat).powi(2) + (b.lng - lng).powi(2);
            da.partial_cmp(&db).unwrap()
        })
        .unwrap()
        .0
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
}
