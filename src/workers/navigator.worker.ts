import { find_route } from "navigator_core";
import { Waypoint } from "../pages/MapView/MapView.types";

self.onmessage = (e: MessageEvent<Waypoint[]>) => {
  const startLat = e.data[0].lat;
  const startLng = e.data[0].lng;
  const endLat = e.data[1].lat;
  const endLng = e.data[1].lng;
  const result = find_route(startLat, startLng, endLat, endLng);
  const dataArray = Array.from(result);
  const distance = dataArray.pop()!;
  postMessage({ coords: dataArray, distance });
};
