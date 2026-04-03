use navigator_common::Graph;
use serde_json::json;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let input = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "graph.bin".into());
    let output = std::env::args()
        .nth(2)
        .unwrap_or_else(|| "graph.geojson".into());

    let data = std::fs::read(&input)?;
    let graph: Graph = bincode::deserialize(&data)?;

    println!("{} nodes, {} edges", graph.nodes.len(), graph.edges.len());

    // Nodes as Point features
    let mut features: Vec<serde_json::Value> = graph
        .nodes
        .iter()
        .enumerate()
        .map(|(i, node)| {
            json!({
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [node.lng, node.lat]
                },
                "properties": {
                    "id": i,
                    "kind": "node"
                }
            })
        })
        .collect();

    // Edges as LineString features
    for edge in &graph.edges {
        let from = &graph.nodes[edge.from as usize];
        let to = &graph.nodes[edge.to as usize];
        features.push(json!({
            "type": "Feature",
            "geometry": {
                "type": "LineString",
                "coordinates": [
                    [from.lng, from.lat],
                    [to.lng, to.lat]
                ]
            },
            "properties": {
                "kind": "edge",
                "distance": edge.distance
            }
        }));
    }

    let geojson = json!({
        "type": "FeatureCollection",
        "features": features
    });

    std::fs::write(&output, serde_json::to_string(&geojson)?)?;
    println!("Wrote {}", output);

    Ok(())
}
