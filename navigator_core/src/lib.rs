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

    match dijkstra(&graph, &adj, closest_start, closest_end) {
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

fn dijkstra(graph: &Graph, adj: &[Vec<(u32, f32)>], start: usize, end: usize) -> Option<(Vec<usize>, f32)> {
    let n = adj.len();
    let mut dist = vec![f32::INFINITY; n];
    let mut prev = vec![usize::MAX; n];
    dist[start] = 0.0;

    let mut heap = BinaryHeap::new();
    heap.push(Reverse((OrderedFloat(0.0_f32), start)));

    while let Some(Reverse((d, u))) = heap.pop() {
        if u == end { break; }
        if *d > dist[u] { continue; }

        for &(v, w) in &adj[u] {
            let sd = graph.nodes[v as usize].shore_distance;
            let penalty = if sd < SHORE_THRESHOLD {
                SHORE_PENALTY * (1.0 - sd / SHORE_THRESHOLD)
            } else {
                0.0
            };
            let nd = *d + w + penalty;
            if nd < dist[v as usize] {
                dist[v as usize] = nd;
                prev[v as usize] = u;
                heap.push(Reverse((OrderedFloat(nd), v as usize)));
            }
        }
    }

    if dist[end] == f32::INFINITY { return None; }
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
