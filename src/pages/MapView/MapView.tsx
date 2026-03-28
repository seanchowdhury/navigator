import Map, { Marker, useMap } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { GeoJSONSource, MapLayerMouseEvent, MapLibreEvent } from "maplibre-gl";
import { useEffect, useRef, useState } from "react";
import { Waypoint } from "./MapView.types";

const longitude = -74.0117;
const latitude = 40.7292;
const zoom = 15;

function onLoad(e: MapLibreEvent) {
  const map = e.target;

  map.addSource("openseamap", {
    type: "raster",
    tiles: ["https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png"],
    tileSize: 256,
  });
  map.addLayer({
    id: "openseamap-layer",
    type: "raster",
    source: "openseamap",
  });

  map.addSource("route", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });

  map.addLayer({
    id: "route-line",
    type: "line",
    source: "route",
    paint: { "line-color": "#2563eb", "line-width": 2 },
  });
}

export default function MapView() {
  const workerRef = useRef<Worker | null>(null);

  const { routeMap } = useMap();
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);

  useEffect(() => {
    if (waypoints.length) {
      const coordinates = waypoints.map((wp) => [wp.lng, wp.lat]);

      (routeMap?.getSource("route") as GeoJSONSource).setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: {},
            geometry: { type: "LineString", coordinates },
          },
        ],
      });
    }
  }, [waypoints, routeMap]);

  useEffect(() => {
    if (waypoints.length < 2) return;

    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../../workers/navigator.worker.ts?worker", import.meta.url),
        { type: "module" },
      );
      workerRef.current.onmessage = (e) => {
        console.log("result from wasm:", e.data);
      };
    }

    const coords = new Float64Array(
      waypoints.flatMap((wp) => [wp.lat, wp.lng]),
    );
    workerRef.current.postMessage(coords);
  }, [waypoints]);

  // function removeWaypoint(id: string) {
  //   setWaypoints((prev) => prev.filter((wp) => wp.id !== id));
  // }

  function handleClick(e: MapLayerMouseEvent) {
    const features = routeMap?.queryRenderedFeatures(e.point);
    if (features?.some((feature) => feature.layer.id == "water")) {
      addWaypoint({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    } else {
      return;
    }
  }

  function addWaypoint({ lat, lng }: { lat: number; lng: number }) {
    setWaypoints((prev) => [
      ...prev,
      { id: crypto.randomUUID(), lat, lng, label: `${prev.length + 1}` },
    ]);
  }

  return (
    <div>
      <Map
        id="routeMap"
        initialViewState={{ latitude, longitude, zoom }}
        style={{ height: "100vh", width: "100%" }}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
        onLoad={(e) => onLoad(e)}
        onClick={handleClick}
      >
        {waypoints.map((waypoint) => {
          return (
            <Marker
              key={waypoint.id}
              longitude={waypoint.lng}
              latitude={waypoint.lat}
            />
          );
        })}
      </Map>
    </div>
  );
}
