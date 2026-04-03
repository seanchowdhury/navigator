use std::fs::File;
use std::io::{BufReader, BufWriter, Write};
use serde_json::Value;

fn is_water_feature(props: &serde_json::Map<String, Value>) -> bool {
    if let Some(Value::String(natural)) = props.get("natural") {
        if matches!(natural.as_str(), "water" | "coastline" | "bay") {
            return true;
        }
    }
    if let Some(Value::String(waterway)) = props.get("waterway") {
        if matches!(waterway.as_str(), "river" | "canal" | "tidal_channel" | "dock" | "drain") {
            return true;
        }
    }
    if let Some(Value::String(harbour)) = props.get("harbour") {
        if harbour == "yes" {
            return true;
        }
    }
    if props.contains_key("water") {
        return true;
    }
    false
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let input = File::open("nyc_map.geojson")?;
    let reader = BufReader::new(input);

    let output = File::create("nyc_water.geojson")?;
    let mut writer = BufWriter::new(output);

    let geojson: Value = serde_json::from_reader(reader)?;

    let empty = vec![];
    let features = geojson["features"].as_array().unwrap_or(&empty);

    let water_features: Vec<&Value> = features
        .iter()
        .filter(|f| {
            f["properties"]
                .as_object()
                .map(|p| is_water_feature(p))
                .unwrap_or(false)
        })
        .collect();

    let output_geojson = serde_json::json!({
        "type": "FeatureCollection",
        "features": water_features
    });

    write!(writer, "{}", output_geojson)?;

    println!("Done — {} water features written to nyc_water.geojson", water_features.len());

    Ok(())
}
