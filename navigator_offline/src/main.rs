use std::collections::{HashMap, HashSet, VecDeque};

use geo::{BoundingRect, Contains, Coord, LineString, Polygon};
use navigator_common::{Edge, Graph, Node};
use osmpbf::{Element, ElementReader};

mod graph_io;

const DEFAULT_GRID_SPACING_M: f64 = 50.0;
const METERS_PER_DEG_LAT: f64 = 111_320.0;

/// Default buffer for open waterway lines (centerlines) in meters; approximates
/// the half-width of the waterway.
const DEFAULT_WATERWAY_BUFFER_M: f64 = 150.0;

const USAGE: &str = "Usage: navigator_offline <input.osm.pbf> <output.bin> [options]

Builds a region's water graph.

Options:
  --bounds <file.geojson>     Polygon clipping the region (default: NYC_bounds.geojson)
  --spacing <meters>          Grid spacing (default: 50)
  --sea-seed <lat,lng>        A point in open sea. Open water that OSM only maps as
                              coastline (e.g. Puget Sound) is flood-filled from each
                              seed, bounded by coastlines. Repeatable.
  --waterway-types <a,b,...>  Waterway relations to buffer into water, e.g. canal,river
                              (default: all, including streams)
  --waterway-buffer <meters>  Half-width those waterways are buffered to (default: 150)";

struct Args {
    pbf_path: String,
    output_path: String,
    bounds_path: String,
    grid_spacing_m: f64,
    /// (lat, lng) points in open sea to flood-fill from.
    sea_seeds: Vec<(f64, f64)>,
    /// `waterway=` values of waterway relations to buffer; None = all.
    waterway_types: Option<HashSet<String>>,
    waterway_buffer_m: f64,
}

fn parse_positive(flag: &str, value: Option<String>) -> Result<f64, String> {
    let value = value.ok_or_else(|| format!("{} needs a number of meters", flag))?;
    value
        .parse()
        .ok()
        .filter(|m: &f64| *m > 0.0)
        .ok_or_else(|| format!("Invalid {} '{}'", flag, value))
}

fn parse_args() -> Result<Args, String> {
    let mut positional = vec![];
    let mut bounds_path = "NYC_bounds.geojson".to_string();
    let mut grid_spacing_m = DEFAULT_GRID_SPACING_M;
    let mut sea_seeds = vec![];
    let mut waterway_types = None;
    let mut waterway_buffer_m = DEFAULT_WATERWAY_BUFFER_M;

    let mut args = std::env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--bounds" => bounds_path = args.next().ok_or("--bounds needs a path")?,
            "--spacing" => grid_spacing_m = parse_positive("--spacing", args.next())?,
            "--waterway-buffer" => waterway_buffer_m = parse_positive("--waterway-buffer", args.next())?,
            "--sea-seed" => {
                let value = args.next().ok_or("--sea-seed needs lat,lng")?;
                let parsed: Vec<f64> = value.split(',').filter_map(|p| p.trim().parse().ok()).collect();
                match parsed[..] {
                    [lat, lng] => sea_seeds.push((lat, lng)),
                    _ => return Err(format!("Invalid --sea-seed '{}' (expected lat,lng)", value)),
                }
            }
            "--waterway-types" => {
                let value = args.next().ok_or("--waterway-types needs a list, e.g. canal,river")?;
                waterway_types = Some(value.split(',').map(|t| t.trim().to_string()).collect());
            }
            "-h" | "--help" => return Err(String::new()),
            flag if flag.starts_with("--") => return Err(format!("Unknown option {}", flag)),
            _ => positional.push(arg),
        }
    }

    let mut positional = positional.into_iter();
    Ok(Args {
        pbf_path: positional.next().unwrap_or_else(|| "nyc.osm.pbf".into()),
        output_path: positional.next().unwrap_or_else(|| "graph.bin".into()),
        bounds_path,
        grid_spacing_m,
        sea_seeds,
        waterway_types,
        waterway_buffer_m,
    })
}

/// Whether a way or multipolygon is a water area. Coastlines are deliberately
/// excluded: a closed coastline way is an island (land), and open sea is filled
/// in separately from --sea-seed.
fn is_water_tags<'a>(tags: impl Iterator<Item = (&'a str, &'a str)>) -> bool {
    for (key, value) in tags {
        match key {
            "natural" if matches!(value, "water" | "bay") => return true,
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

    let mut coords = geojson["features"][0]["geometry"]["coordinates"]
        .as_array()
        .expect("Expected coordinates array in bounds GeoJSON");
    // A standard Polygon nests its outer ring one level deeper ([[ [x, y], ... ]]);
    // older bounds files have the ring directly ([ [x, y], ... ]).
    if coords.first().and_then(|c| c[0].as_array()).is_some() {
        coords = coords[0].as_array().expect("Expected outer ring in bounds Polygon");
    }

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
    let Args {
        pbf_path,
        output_path,
        bounds_path,
        grid_spacing_m,
        sea_seeds,
        waterway_types,
        waterway_buffer_m,
    } = match parse_args() {
        Ok(args) => args,
        Err(message) => {
            if !message.is_empty() {
                eprintln!("{}\n", message);
            }
            eprintln!("{}", USAGE);
            std::process::exit(if message.is_empty() { 0 } else { 2 });
        }
    };

    // Load the region's bounds for clipping
    let bounds = load_bounds_polygon(&bounds_path)?;
    println!("Loaded bounds polygon from {}", bounds_path);

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
                // Waterway relations (rivers, streams, canals) become buffered
                // centerlines; --waterway-types limits which kinds.
                Some("waterway") => match &waterway_types {
                    None => true,
                    Some(types) => rel
                        .tags()
                        .find(|(k, _)| *k == "waterway")
                        .map_or(false, |(_, v)| types.contains(v)),
                },
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
    let mut coastline_ways: Vec<Vec<i64>> = Vec::new();
    let mut way_refs: HashMap<i64, Vec<i64>> = HashMap::new();
    let mut needed_ids: HashSet<i64> = HashSet::new();

    reader.for_each(|element| {
        if let Element::Way(way) = element {
            let refs: Vec<i64> = way.refs().collect();

            // Coastlines bound the sea flood fill (only needed with --sea-seed)
            if !sea_seeds.is_empty()
                && way.tags().any(|(k, v)| k == "natural" && v == "coastline")
            {
                for &id in &refs {
                    needed_ids.insert(id);
                }
                coastline_ways.push(refs.clone());
            }

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

    if polygons.is_empty() && sea_seeds.is_empty() {
        eprintln!("No water polygons found. Check that the PBF file covers the expected area.");
        return Ok(());
    }

    // Use the region's bounds as the bounding box for grid generation
    let bounds_rect = bounds.bounding_rect().expect("Bounds polygon has no bbox");
    let min_lat = bounds_rect.min().y;
    let max_lat = bounds_rect.max().y;
    let min_lng = bounds_rect.min().x;
    let max_lng = bounds_rect.max().x;

    let ref_lat = (min_lat + max_lat) / 2.0;
    let lat_step = grid_spacing_m / METERS_PER_DEG_LAT;
    let lng_step = grid_spacing_m / (METERS_PER_DEG_LAT * ref_lat.to_radians().cos());

    println!(
        "  Bounds: ({:.4}, {:.4}) to ({:.4}, {:.4})",
        min_lat, min_lng, max_lat, max_lng
    );
    println!(
        "  Grid spacing: {:.6} deg lat, {:.6} deg lng (~{}m)",
        lat_step, lng_step, grid_spacing_m
    );

    // For each polygon, rasterize grid cells that fall inside it AND within bounds
    println!("Generating water grid (this may take a moment)...");
    let mut water_cells: HashSet<(i32, i32)> = HashSet::new();

    for (i, poly) in polygons.iter().enumerate() {
        if let Some(rect) = poly.bounding_rect() {
            // Clip polygon bbox to the region's bounds
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
    let buffer_deg_lat = waterway_buffer_m / METERS_PER_DEG_LAT;
    let buffer_deg_lng = waterway_buffer_m / (METERS_PER_DEG_LAT * cos_ref_lat);

    println!("Buffering {} waterway centerlines ({}m buffer)...", waterway_lines.len(), waterway_buffer_m);
    for (i, line) in waterway_lines.iter().enumerate() {
        let coords: Vec<Coord<f64>> = line.0.clone();
        for seg_idx in 0..coords.len().saturating_sub(1) {
            let a = coords[seg_idx];
            let b = coords[seg_idx + 1];

            // Bounding box of this segment + buffer, clipped to the region's bounds
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
                    if dist <= waterway_buffer_m {
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

    // Open sea: OSM often maps it only as coastline (land on the left, water on
    // the right), not as water areas. Draw every coastline onto the grid as a wall,
    // then flood-fill from each seed point without crossing a wall.
    if !sea_seeds.is_empty() {
        let to_grid = |lat: f64, lng: f64| ((lat - min_lat) / lat_step, (lng - min_lng) / lng_step);
        let mut walls: HashSet<(i32, i32)> = HashSet::new();
        for refs in &coastline_ways {
            let Some(coords) = refs_to_coords(refs) else { continue };
            for pair in coords.windows(2) {
                let (r0, c0) = to_grid(pair[0].y, pair[0].x);
                let (r1, c1) = to_grid(pair[1].y, pair[1].x);
                // Sample at quarter-cell steps. Where consecutive cells differ
                // diagonally, also wall one of the corner cells so a 4-connected
                // fill can't slip between them.
                let steps = ((r1 - r0).abs().max((c1 - c0).abs()) * 4.0).ceil().max(1.0) as i32;
                let mut prev: Option<(i32, i32)> = None;
                for s in 0..=steps {
                    let t = s as f64 / steps as f64;
                    let cell = ((r0 + (r1 - r0) * t).round() as i32, (c0 + (c1 - c0) * t).round() as i32);
                    if let Some(p) = prev {
                        if p.0 != cell.0 && p.1 != cell.1 {
                            walls.insert((cell.0, p.1));
                        }
                    }
                    walls.insert(cell);
                    prev = Some(cell);
                }
            }
        }
        println!("Sea fill: {} coastline ways, {} wall cells", coastline_ways.len(), walls.len());

        let max_row = ((max_lat - min_lat) / lat_step).ceil() as i32;
        let max_col = ((max_lng - min_lng) / lng_step).ceil() as i32;
        let in_region = |row: i32, col: i32| {
            row >= 0 && col >= 0 && row <= max_row && col <= max_col && bounds.contains(&geo::Point::new(
                min_lng + (col as f64) * lng_step,
                min_lat + (row as f64) * lat_step,
            ))
        };

        let mut sea: HashSet<(i32, i32)> = HashSet::new();
        let mut queue: VecDeque<(i32, i32)> = VecDeque::new();
        for &(lat, lng) in &sea_seeds {
            let (r, c) = to_grid(lat, lng);
            let seed = (r.round() as i32, c.round() as i32);
            if !in_region(seed.0, seed.1) || walls.contains(&seed) {
                return Err(format!("--sea-seed {},{} is outside the bounds or on a coastline", lat, lng).into());
            }
            if sea.insert(seed) {
                queue.push_back(seed);
            }
        }
        while let Some((row, col)) = queue.pop_front() {
            for next in [(row - 1, col), (row + 1, col), (row, col - 1), (row, col + 1)] {
                if !sea.contains(&next) && !walls.contains(&next) && in_region(next.0, next.1) {
                    sea.insert(next);
                    queue.push_back(next);
                }
            }
        }
        let total_cells = ((max_row + 1) as usize) * ((max_col + 1) as usize);
        println!(
            "  Filled {} sea cells ({:.0}% of the region grid)",
            sea.len(),
            100.0 * sea.len() as f64 / total_cells as f64
        );
        water_cells.extend(sea);
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
            shore_distance: (grid_steps as f32) * grid_spacing_m as f32,
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
                    grid_spacing_m as f32
                } else {
                    (grid_spacing_m * std::f64::consts::SQRT_2) as f32
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
    let written = graph_io::write_graph(&graph, &output_path)?;
    println!(
        "Wrote graph to {} ({:.1} MB)",
        output_path,
        written as f64 / 1_048_576.0
    );
    println!(
        "  {} nodes, {} edges",
        graph.nodes.len(),
        graph.edges.len()
    );

    Ok(())
}
