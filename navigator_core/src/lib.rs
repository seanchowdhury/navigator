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

#[wasm_bindgen]
pub fn find_route(start_lat: f64, start_lng: f64, end_lat: f64, end_lng: f64) -> Vec<f64> {
    let data = include_bytes!("../graph.bin");
    let graph: Graph = bincode::deserialize(data).expect("Failed to deserialize graph");

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

    let mut g_score = vec![f32::INFINITY; n];
    let mut prev = vec![usize::MAX; n];
    g_score[start] = 0.0;

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
                prev[vi] = u;
                let h = haversine(graph.nodes[vi].lat, graph.nodes[vi].lng, goal_lat, goal_lng);
                heap.push(Reverse((OrderedFloat(tentative_g + h), vi)));
            }
        }
    }

    if g_score[end] == f32::INFINITY { return None; }
    let total_distance = g_score[end];
    let mut path = vec![end];
    let mut cur = end;
    while cur != start {
        cur = prev[cur];
        path.push(cur);
    }
    path.reverse();
    Some((path, total_distance))
}
