use navigator_common::Graph;

/// Rebuilds graph.bin from a JSON graph (as exported by the in-browser graph editor).
///
/// Usage: build_graph <input.json> [output.bin]
fn main() -> Result<(), Box<dyn std::error::Error>> {
    let input = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "graph.edited.json".into());
    let output = std::env::args()
        .nth(2)
        .unwrap_or_else(|| "graph.bin".into());

    let data = std::fs::read_to_string(&input)?;
    let graph: Graph = serde_json::from_str(&data)?;

    println!("{} nodes, {} edges", graph.nodes.len(), graph.edges.len());

    for edge in &graph.edges {
        if edge.from as usize >= graph.nodes.len() || edge.to as usize >= graph.nodes.len() {
            return Err(format!(
                "Edge references out-of-range node (from={}, to={}, node count={})",
                edge.from,
                edge.to,
                graph.nodes.len()
            )
            .into());
        }
    }

    let encoded = bincode::serialize(&graph)?;
    std::fs::write(&output, &encoded)?;
    println!(
        "Wrote graph to {} ({:.1} MB)",
        output,
        encoded.len() as f64 / 1_048_576.0
    );

    Ok(())
}
