import init, { find_route } from "navigator_core";
import { Waypoint } from "../pages/MapView/MapView.types";

const ready = init();

self.onmessage = async (e: MessageEvent<Waypoint[]>) => {
  await ready;
  const startLat = e.data[0].lat;
  const startLng = e.data[0].lng;
  const endLat = e.data[1].lat;
  const endLng = e.data[1].lng;
  const result = find_route(startLat, startLng, endLat, endLng);
  const dataArray = Array.from(result);
  const distance = dataArray.pop()!;
  const smoothed = smoothCoords(dataArray, 5);
  postMessage({ coords: smoothed, distance });
};

/** Sliding-window average over lat/lng pairs to reduce grid zigzag */
function smoothCoords(coords: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  const count = coords.length / 2;
  if (count <= window) return coords;

  const out = new Array(coords.length);
  // Keep first and last points exact
  out[0] = coords[0];
  out[1] = coords[1];
  out[coords.length - 2] = coords[coords.length - 2];
  out[coords.length - 1] = coords[coords.length - 1];

  for (let i = 1; i < count - 1; i++) {
    let sumLat = 0;
    let sumLng = 0;
    let n = 0;
    for (let j = Math.max(0, i - half); j <= Math.min(count - 1, i + half); j++) {
      sumLat += coords[j * 2];
      sumLng += coords[j * 2 + 1];
      n++;
    }
    out[i * 2] = sumLat / n;
    out[i * 2 + 1] = sumLng / n;
  }
  return out;
}
