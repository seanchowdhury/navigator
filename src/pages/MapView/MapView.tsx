import Map, { Marker, useMap } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { GeoJSONSource, MapLayerMouseEvent, MapLibreEvent } from "maplibre-gl";
import { useEffect, useRef, useState, useCallback } from "react";
import { Waypoint } from "./MapView.types";
import RouteInfo from "./components/RouteInfo";
import {
  calculateTidalRoute,
  TidalRouteResult,
} from "../../services/tidalRoute";

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

  const routeCoordsRef = useRef<number[][]>([]);
  const [totalDistance, setTotalDistance] = useState(0);
  const [tidalResult, setTidalResult] = useState<TidalRouteResult | null>(null);
  const [tidalLoading, setTidalLoading] = useState(false);
  const [speedKnots, setSpeedKnots] = useState(4);
  const [departureTime, setDepartureTime] = useState(() =>
    new Date().toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: "America/New_York",
    }),
  );
  const [departureDate, setDepartureDate] = useState(() => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  });

  const recalcTidal = useCallback(
    async (coords: number[][], speed: number, timeStr: string, dateStr: string) => {
      if (coords.length < 2) return;
      setTidalLoading(true);
      try {
        const [hours, minutes] = timeStr.split(":").map(Number);
        const [year, month, day] = dateStr.split("-").map(Number);
        const departure = new Date(year, month - 1, day, hours, minutes, 0, 0);
        const result = await calculateTidalRoute(coords, departure, speed);
        setTidalResult(result);
      } catch (e) {
        console.error("Tidal calculation failed:", e);
        setTidalResult(null);
      } finally {
        setTidalLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!routeMap) return;
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../../workers/navigator.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current.onmessage = (e) => {
        const { coords: rawCoords, distance } = e.data as {
          coords: number[];
          distance: number;
        };
        const coords: number[][] = [];
        for (let i = 0; i < rawCoords.length; i += 2) {
          coords.push([rawCoords[i + 1], rawCoords[i]]);
        }
        routeCoordsRef.current = [...routeCoordsRef.current, ...coords];
        setTotalDistance((prev) => prev + distance);

        (routeMap?.getSource("route") as GeoJSONSource).setData({
          type: "FeatureCollection",
          features: [
            {
              type: "Feature",
              properties: {},
              geometry: {
                type: "LineString",
                coordinates: routeCoordsRef.current,
              },
            },
          ],
        });

        recalcTidal(routeCoordsRef.current, speedKnots, departureTime, departureDate);
      };
    }
  }, [routeMap]);

  useEffect(() => {
    if (waypoints.length < 2) return;

    workerRef.current?.postMessage([
      waypoints[waypoints.length - 2],
      waypoints[waypoints.length - 1],
    ]);
  }, [waypoints, routeMap]);

  function handleClick(e: MapLayerMouseEvent) {
    if (!routeMap || !workerRef.current) return;

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

  function clearRoute() {
    setWaypoints([]);
    setTotalDistance(0);
    setTidalResult(null);
    routeCoordsRef.current = [];
    (routeMap?.getSource("route") as GeoJSONSource)?.setData({
      type: "FeatureCollection",
      features: [],
    });
  }

  return (
    <div className="relative">
      <RouteInfo
        totalDistance={totalDistance}
        onClear={clearRoute}
        tidalResult={tidalResult}
        tidalLoading={tidalLoading}
        speedKnots={speedKnots}
        onSpeedChange={(speed) => {
          setSpeedKnots(speed);
          recalcTidal(routeCoordsRef.current, speed, departureTime, departureDate);
        }}
        departureTime={departureTime}
        onDepartureTimeChange={(time) => {
          setDepartureTime(time);
          recalcTidal(routeCoordsRef.current, speedKnots, time, departureDate);
        }}
        departureDate={departureDate}
        onDepartureDateChange={(date) => {
          setDepartureDate(date);
          recalcTidal(routeCoordsRef.current, speedKnots, departureTime, date);
        }}
      />
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
