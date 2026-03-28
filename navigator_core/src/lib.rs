mod utils;

use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    fn alert(s: &str);
}

#[wasm_bindgen]
pub fn find_route(lat: Vec<f64>, lng: Vec<f64>) -> String {
    return format!("Latitude and long recieved")
}
