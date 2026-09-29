use navigator_common::Graph;

mod graph_io;

/// Rebuilds a region's graph file from a JSON graph (as exported by the in-browser
/// graph editor). An output path ending in .gz is written gzipped, as the app ships.
///
/// Usage: build_graph <input.json> [output.bin[.gz]]
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

    let written = graph_io::write_graph(&graph, &output)?;
    println!(
        "Wrote graph to {} ({:.1} MB)",
        output,
        written as f64 / 1_048_576.0
    );

    Ok(())
}
