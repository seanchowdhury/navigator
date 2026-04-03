use std::collections::{HashMap, HashSet, VecDeque};

use geo::{BoundingRect, Contains, Coord, LineString, Polygon};
use navigator_common::{Edge, Graph, Node};
use osmpbf::{Element, ElementReader};

const GRID_SPACING_M: f64 = 50.0;
const METERS_PER_DEG_LAT: f64 = 111_320.0;
/// Buffer distance for open waterway lines (centerlines) in meters.
/// This approximates the half-width of the waterway.
const WATERWAY_BUFFER_M: f64 = 150.0;

fn is_water_tags<'a>(tags: impl Iterator<Item = (&'a str, &'a str)>) -> bool {
    for (key, value) in tags {
        match key {
            "natural" if matches!(value, "water" | "bay" | "coastline") => return true,
            "water" => return true,
            "waterway" => return true,
            "landuse" if value == "reservoir" => return true,
            "leisure" if value == "marina" => return true,
            _ => {}
        }
    }
    false
}

/// Assemble a set of ways (as node ID sequences) into closed rings.
/// Ways are chained end-to-end where the last node of one matches the
/// first (or last, reversed) node of the next.
fn assemble_rings(ways: Vec<Vec<i64>>) -> Vec<Vec<i64>> {
    let mut remaining = ways;
    let mut rings = Vec::new();

    while !remaining.is_empty() {
        let mut current = remaining.remove(0);

        loop {
            // Check if we've closed the ring
            if current.len() > 3 && current.first() == current.last() {
                rings.push(current);
                break;
            }

            let last = *current.last().unwrap();
            let mut found = false;

            for i in 0..remaining.len() {
                let first_of_candidate = *remaining[i].first().unwrap();
                let last_of_candidate = *remaining[i].last().unwrap();

                if first_of_candidate == last {
                    let mut next = remaining.remove(i);
                    next.remove(0); // remove duplicate join node
                    current.extend(next);
                    found = true;
                    break;
                } else if last_of_candidate == last {
                    let mut next = remaining.remove(i);
                    next.reverse();
                    next.remove(0); // remove duplicate join node
                    current.extend(next);
                    found = true;
                    break;
                }
            }

            if !found {
                // Can't close this ring, discard it
                break;
            }
        }
    }

    rings
}

/// Assemble ways into open chains (for waterway centerlines that won't form closed rings).
/// Returns all chains, including incomplete ones.
fn assemble_chains(ways: Vec<Vec<i64>>) -> Vec<Vec<i64>> {
    let mut remaining = ways;
    let mut chains = Vec::new();

    while !remaining.is_empty() {
        let mut current = remaining.remove(0);

        loop {
            let last = *current.last().unwrap();
            let mut found = false;

            for i in 0..remaining.len() {
                let first_of_candidate = *remaining[i].first().unwrap();
                let last_of_candidate = *remaining[i].last().unwrap();

                if first_of_candidate == last {
                    let mut next = remaining.remove(i);
                    next.remove(0);
                    current.extend(next);
                    found = true;
                    break;
                } else if last_of_candidate == last {
                    let mut next = remaining.remove(i);
                    next.reverse();
                    next.remove(0);
                    current.extend(next);
                    found = true;
                    break;
                }
            }

            if !found {
                break;
            }
        }

        if current.len() >= 2 {
            chains.push(current);
        }
    }

    chains
}

/// Minimum distance in meters from a point to a line segment, using approximate
/// degree-to-meter conversion at the given reference latitude.
fn point_to_segment_distance_m(
    px: f64, py: f64,
    ax: f64, ay: f64,
    bx: f64, by: f64,
    cos_ref_lat: f64,
) -> f64 {
    // Convert to approximate meters for distance calc
    let scale_x = METERS_PER_DEG_LAT * cos_ref_lat;
    let scale_y = METERS_PER_DEG_LAT;

    let dx = (bx - ax) * scale_x;
    let dy = (by - ay) * scale_y;
    let len_sq = dx * dx + dy * dy;

    if len_sq == 0.0 {
        let ex = (px - ax) * scale_x;
        let ey = (py - ay) * scale_y;
        return (ex * ex + ey * ey).sqrt();
    }

    let t = (((px - ax) * scale_x * dx + (py - ay) * scale_y * dy) / len_sq).clamp(0.0, 1.0);

    let proj_x = ax * scale_x + t * dx;
    let proj_y = ay * scale_y + t * dy;

    let ex = px * scale_x - proj_x;
    let ey = py * scale_y - proj_y;
    (ex * ex + ey * ey).sqrt()
}

fn load_bounds_polygon(path: &str) -> Result<Polygon<f64>, Box<dyn std::error::Error>> {
    let data = std::fs::read_to_string(path)?;
    let geojson: serde_json::Value = serde_json::from_str(&data)?;

    let coords = geojson["features"][0]["geometry"]["coordinates"]
        .as_array()
        .expect("Expected coordinates array in bounds GeoJSON");

    let ring: Vec<Coord<f64>> = coords
        .iter()
        .map(|c| Coord {
            x: c[0].as_f64().unwrap(),
            y: c[1].as_f64().unwrap(),
        })
        .collect();

    Ok(Polygon::new(LineString::new(ring), vec![]))
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let pbf_path = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "nyc.osm.pbf".into());
    let output_path = std::env::args()
        .nth(2)
        .unwrap_or_else(|| "graph.bin".into());

    // Load NYC bounds for clipping
    let bounds = load_bounds_polygon("NYC_bounds.geojson")?;
    println!("Loaded NYC bounds polygon");

    // Pass 1: find water multipolygon relations and their member way IDs
    println!("Pass 1: Scanning for water relations...");
    let reader = ElementReader::from_path(&pbf_path)?;
    // relation_id -> (outer_way_ids, inner_way_ids)
    let mut relation_ways: HashMap<i64, (Vec<i64>, Vec<i64>)> = HashMap::new();
    let mut all_relation_way_ids: HashSet<i64> = HashSet::new();

    reader.for_each(|element| {
        if let Element::Relation(rel) = element {
            let rel_type = rel.tags().find(|(k, _)| *k == "type").map(|(_, v)| v);
            let is_water_rel = match rel_type {
                Some("multipolygon") => is_water_tags(rel.tags()),
                Some("waterway") => true,
                _ => false,
            };
            if is_water_rel {
                let mut outers = Vec::new();
                let mut inners = Vec::new();
                for member in rel.members() {
                    if member.member_type == osmpbf::elements::RelMemberType::Way {
                        let role = member.role().unwrap_or("");
                        match role {
                            "outer" | "main_stream" | "side_stream" | "" => {
                                outers.push(member.member_id);
                                all_relation_way_ids.insert(member.member_id);
                            }
                            "inner" => {
                                inners.push(member.member_id);
                                all_relation_way_ids.insert(member.member_id);
                            }
                            _ => {
                                // Include other roles (e.g. "tributary") as outer
                                outers.push(member.member_id);
                                all_relation_way_ids.insert(member.member_id);
                            }
                        }
                    }
                }
                if !outers.is_empty() {
                    relation_ways.insert(rel.id(), (outers, inners));
                }
            }
        }
    })?;
    println!(
        "  Found {} water relations referencing {} ways",
        relation_ways.len(),
        all_relation_way_ids.len()
    );

    // Pass 2: collect way node refs for relation members + standalone closed water ways
    println!("Pass 2: Collecting ways...");
    let reader = ElementReader::from_path(&pbf_path)?;
    let mut standalone_ways: Vec<Vec<i64>> = Vec::new();
    let mut way_refs: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut needed_ids: HashSet<i64> = HashSet::new();

    reader.for_each(|element| {
        if let Element::Way(way) = element {
            let refs: Vec<i64> = way.refs().collect();

            // Collect relation member ways
            if all_relation_way_ids.contains(&way.id()) {
                for &id in &refs {
                    needed_ids.insert(id);
                }
                way_refs.insert(way.id(), refs.clone());
            }

            // Collect standalone closed water ways
            if is_water_tags(way.tags()) && refs.len() >= 4 && refs.first() == refs.last() {
                for &id in &refs {
                    needed_ids.insert(id);
                }
                standalone_ways.push(refs);
            }
        }
    })?;
    println!(
        "  Found {} standalone closed water ways",
        standalone_ways.len()
    );
    println!(
        "  Resolved {} relation member ways",
        way_refs.len()
    );
    println!("  Need {} node coordinates", needed_ids.len());

    // Pass 3: resolve node coordinates
    println!("Pass 3: Collecting node coordinates...");
    let reader = ElementReader::from_path(&pbf_path)?;
    let mut node_coords: HashMap<i64, (f64, f64)> = HashMap::new();

    reader.for_each(|element| {
        let (id, lat, lon) = match element {
            Element::Node(n) => (n.id(), n.lat(), n.lon()),
            Element::DenseNode(n) => (n.id(), n.lat(), n.lon()),
            _ => return,
        };
        if needed_ids.contains(&id) {
            node_coords.insert(id, (lat, lon));
        }
    })?;
    println!("  Collected {} node coordinates", node_coords.len());

    // Helper: convert a sequence of node IDs to geo coordinates
    let refs_to_coords = |refs: &[i64]| -> Option<Vec<Coord<f64>>> {
        refs.iter()
            .map(|id| {
                node_coords
                    .get(id)
                    .map(|&(lat, lon)| Coord { x: lon, y: lat })
            })
            .collect()
    };

    // Build polygons from standalone closed ways
    println!("Building polygons...");
    let mut polygons: Vec<Polygon<f64>> = Vec::new();

    for refs in &standalone_ways {
        if let Some(coords) = refs_to_coords(refs) {
            polygons.push(Polygon::new(LineString::new(coords), vec![]));
        }
    }
    let standalone_count = polygons.len();

    // Assemble polygons and waterway lines from relation member ways
    let mut waterway_lines: Vec<LineString<f64>> = Vec::new();

    for (_rel_id, (outer_ids, inner_ids)) in &relation_ways {
        // Collect the outer member ways
        let outer_way_seqs: Vec<Vec<i64>> = outer_ids
            .iter()
            .filter_map(|id| way_refs.get(id).cloned())
            .collect();

        // Try to assemble closed rings first
        let outer_rings = assemble_rings(outer_way_seqs.clone());

        if !outer_rings.is_empty() {
            // Collect inner member ways (holes)
            let inner_way_seqs: Vec<Vec<i64>> = inner_ids
                .iter()
                .filter_map(|id| way_refs.get(id).cloned())
                .collect();

            let inner_rings = assemble_rings(inner_way_seqs);

            let inner_linestrings: Vec<LineString<f64>> = inner_rings
                .iter()
                .filter_map(|ring| refs_to_coords(ring).map(LineString::new))
                .collect();

            for ring in &outer_rings {
                if let Some(coords) = refs_to_coords(ring) {
                    polygons.push(Polygon::new(
                        LineString::new(coords),
                        inner_linestrings.clone(),
                    ));
                }
            }
        } else {
            // No closed rings — treat as waterway centerlines and buffer them
            let chains = assemble_chains(outer_way_seqs);
            for chain in &chains {
                if let Some(coords) = refs_to_coords(chain) {
                    waterway_lines.push(LineString::new(coords));
                }
            }
        }
    }
    println!(
        "  Built {} polygons ({} standalone, {} from relations)",
        polygons.len(),
        standalone_count,
        polygons.len() - standalone_count
    );
    println!(
        "  Built {} waterway centerlines to buffer",
        waterway_lines.len()
    );

    if polygons.is_empty() {
        eprintln!("No water polygons found. Check that the PBF file covers the expected area.");
        return Ok(());
    }

    // Use NYC bounds as the bounding box for grid generation
    let bounds_rect = bounds.bounding_rect().expect("Bounds polygon has no bbox");
    let min_lat = bounds_rect.min().y;
    let max_lat = bounds_rect.max().y;
    let min_lng = bounds_rect.min().x;
    let max_lng = bounds_rect.max().x;

    let ref_lat = (min_lat + max_lat) / 2.0;
    let lat_step = GRID_SPACING_M / METERS_PER_DEG_LAT;
    let lng_step = GRID_SPACING_M / (METERS_PER_DEG_LAT * ref_lat.to_radians().cos());

    println!(
        "  Bounds: ({:.4}, {:.4}) to ({:.4}, {:.4})",
        min_lat, min_lng, max_lat, max_lng
    );
    println!(
        "  Grid spacing: {:.6} deg lat, {:.6} deg lng (~50m)",
        lat_step, lng_step
    );

    // For each polygon, rasterize grid cells that fall inside it AND within bounds
    println!("Generating water grid (this may take a moment)...");
    let mut water_cells: HashSet<(i32, i32)> = HashSet::new();

    for (i, poly) in polygons.iter().enumerate() {
        if let Some(rect) = poly.bounding_rect() {
            // Clip polygon bbox to NYC bounds
            let poly_min_lat = rect.min().y.max(min_lat);
            let poly_max_lat = rect.max().y.min(max_lat);
            let poly_min_lng = rect.min().x.max(min_lng);
            let poly_max_lng = rect.max().x.min(max_lng);

            if poly_min_lat >= poly_max_lat || poly_min_lng >= poly_max_lng {
                continue; // polygon is outside bounds
            }

            let row_min = ((poly_min_lat - min_lat) / lat_step).floor() as i32;
            let row_max = ((poly_max_lat - min_lat) / lat_step).ceil() as i32;
            let col_min = ((poly_min_lng - min_lng) / lng_step).floor() as i32;
            let col_max = ((poly_max_lng - min_lng) / lng_step).ceil() as i32;

            for row in row_min..=row_max {
                for col in col_min..=col_max {
                    let lat = min_lat + (row as f64) * lat_step;
                    let lng = min_lng + (col as f64) * lng_step;
                    let point = geo::Point::new(lng, lat);
                    if poly.contains(&point) && bounds.contains(&point) {
                        water_cells.insert((row, col));
                    }
                }
            }
        }

        if (i + 1) % 500 == 0 {
            println!("  Processed {}/{} polygons...", i + 1, polygons.len());
        }
    }
    // Rasterize buffered waterway centerlines
    let cos_ref_lat = ref_lat.to_radians().cos();
    let buffer_deg_lat = WATERWAY_BUFFER_M / METERS_PER_DEG_LAT;
    let buffer_deg_lng = WATERWAY_BUFFER_M / (METERS_PER_DEG_LAT * cos_ref_lat);

    println!("Buffering {} waterway centerlines ({}m buffer)...", waterway_lines.len(), WATERWAY_BUFFER_M);
    for (i, line) in waterway_lines.iter().enumerate() {
        let coords: Vec<Coord<f64>> = line.0.clone();
        for seg_idx in 0..coords.len().saturating_sub(1) {
            let a = coords[seg_idx];
            let b = coords[seg_idx + 1];

            // Bounding box of this segment + buffer, clipped to NYC bounds
            let seg_min_lng = a.x.min(b.x) - buffer_deg_lng;
            let seg_max_lng = a.x.max(b.x) + buffer_deg_lng;
            let seg_min_lat = a.y.min(b.y) - buffer_deg_lat;
            let seg_max_lat = a.y.max(b.y) + buffer_deg_lat;

            let clipped_min_lat = seg_min_lat.max(min_lat);
            let clipped_max_lat = seg_max_lat.min(max_lat);
            let clipped_min_lng = seg_min_lng.max(min_lng);
            let clipped_max_lng = seg_max_lng.min(max_lng);

            if clipped_min_lat >= clipped_max_lat || clipped_min_lng >= clipped_max_lng {
                continue;
            }

            let row_min = ((clipped_min_lat - min_lat) / lat_step).floor() as i32;
            let row_max = ((clipped_max_lat - min_lat) / lat_step).ceil() as i32;
            let col_min = ((clipped_min_lng - min_lng) / lng_step).floor() as i32;
            let col_max = ((clipped_max_lng - min_lng) / lng_step).ceil() as i32;

            for row in row_min..=row_max {
                for col in col_min..=col_max {
                    let lat = min_lat + (row as f64) * lat_step;
                    let lng = min_lng + (col as f64) * lng_step;
                    let dist = point_to_segment_distance_m(
                        lng, lat, a.x, a.y, b.x, b.y, cos_ref_lat,
                    );
                    if dist <= WATERWAY_BUFFER_M {
                        let point = geo::Point::new(lng, lat);
                        if bounds.contains(&point) {
                            water_cells.insert((row, col));
                        }
                    }
                }
            }
        }

        if (i + 1) % 100 == 0 {
            println!("  Buffered {}/{} waterway lines...", i + 1, waterway_lines.len());
        }
    }

    println!("  Found {} water grid cells", water_cells.len());

    let neighbors: [(i32, i32); 8] = [
        (-1, -1), (-1, 0), (-1, 1),
        (0, -1),           (0, 1),
        (1, -1),  (1, 0),  (1, 1),
    ];

    // Compute shore distance for each water cell via BFS distance transform
    println!("Computing shore distances...");
    let mut shore_dist: HashMap<(i32, i32), u32> = HashMap::new();
    let mut queue: VecDeque<(i32, i32)> = VecDeque::new();

    // Seed: water cells adjacent to at least one non-water cell (shore boundary)
    for &(row, col) in &water_cells {
        let on_shore = neighbors.iter().any(|&(dr, dc)| {
            !water_cells.contains(&(row + dr, col + dc))
        });
        if on_shore {
            shore_dist.insert((row, col), 0);
            queue.push_back((row, col));
        }
    }
    println!("  {} shore boundary cells", queue.len());

    // BFS flood fill outward
    while let Some((row, col)) = queue.pop_front() {
        let d = shore_dist[&(row, col)];
        for &(dr, dc) in &neighbors {
            let next = (row + dr, col + dc);
            if water_cells.contains(&next) && !shore_dist.contains_key(&next) {
                shore_dist.insert(next, d + 1);
                queue.push_back(next);
            }
        }
    }

    // Convert grid cells to graph nodes
    let mut cell_to_id: HashMap<(i32, i32), u32> = HashMap::new();
    let mut nodes: Vec<Node> = Vec::new();

    for &(row, col) in &water_cells {
        let id = nodes.len() as u32;
        let grid_steps = shore_dist.get(&(row, col)).copied().unwrap_or(0);
        cell_to_id.insert((row, col), id);
        nodes.push(Node {
            lat: min_lat + (row as f64) * lat_step,
            lng: min_lng + (col as f64) * lng_step,
            shore_distance: (grid_steps as f32) * GRID_SPACING_M as f32,
        });
    }

    // Build edges between 8-connected grid neighbors
    println!("Building edges...");
    let mut edges: Vec<Edge> = Vec::new();

    for &(row, col) in &water_cells {
        let from_id = cell_to_id[&(row, col)];
        for &(dr, dc) in &neighbors {
            if let Some(&to_id) = cell_to_id.get(&(row + dr, col + dc)) {
                let distance = if dr == 0 || dc == 0 {
                    GRID_SPACING_M as f32
                } else {
                    (GRID_SPACING_M * std::f64::consts::SQRT_2) as f32
                };
                edges.push(Edge {
                    from: from_id,
                    to: to_id,
                    distance,
                });
            }
        }
    }
    println!("  Built {} edges", edges.len());

    // Serialize and write the graph
    let graph = Graph { nodes, edges };
    let encoded = bincode::serialize(&graph)?;
    std::fs::write(&output_path, &encoded)?;
    println!(
        "Wrote graph to {} ({:.1} MB)",
        output_path,
        encoded.len() as f64 / 1_048_576.0
    );
    println!(
        "  {} nodes, {} edges",
        graph.nodes.len(),
        graph.edges.len()
    );

    Ok(())
}
