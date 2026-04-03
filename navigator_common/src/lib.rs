use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Node {
    pub lat: f64,
    pub lng: f64,
    pub shore_distance: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Edge {
    pub from: u32,
    pub to: u32,
    pub distance: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
pub struct Graph {
    pub nodes: Vec<Node>,
    pub edges: Vec<Edge>,
}
