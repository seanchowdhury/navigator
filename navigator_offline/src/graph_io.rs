//! Writing graph files. Shared by the navigator_offline and build_graph binaries.

use std::io::Write;

use flate2::{Compression, write::GzEncoder};
use navigator_common::Graph;

/// Serializes the graph with bincode and writes it to `path`, gzipped when the
/// path ends in `.gz` (what the app ships: src/assets/graphs/<region>.bin.gz).
/// Returns the number of bytes written.
pub fn write_graph(graph: &Graph, path: &str) -> Result<usize, Box<dyn std::error::Error>> {
    let encoded = bincode::serialize(graph)?;
    let bytes = if path.ends_with(".gz") {
        let mut encoder = GzEncoder::new(Vec::new(), Compression::best());
        encoder.write_all(&encoded)?;
        encoder.finish()?
    } else {
        encoded
    };
    std::fs::write(path, &bytes)?;
    Ok(bytes.len())
}
