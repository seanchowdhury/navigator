import Map, { Marker, useMap } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { GeoJSONSource, MapLayerMouseEvent, MapLibreEvent } from "maplibre-gl";
import { useEffect, useRef, useState, useCallback } from "react";
import { Waypoint } from "./MapView.types";
import RouteInfo from "./components/RouteInfo";
import {
  fetchTidalData,
  recomputeTidalRoute,
  TidalRouteResult,
  TidalRouteCache,
  VesselType,
} from "../../services/tidalRoute";
import {
  fetchWindForecast,
  interpolateWind,
  WindForecast,
} from "../../services/nws";

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

function parseDeparture(timeStr: string, dateStr: string): Date {
  const [hours, minutes] = timeStr.split(":").map(Number);
  const [year, month, day] = dateStr.split("-").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0);
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
  const [vesselType, setVesselType] = useState<VesselType>("whitehall_gig");
  const [weather, setWeather] = useState<WindForecast | null>(null);

  // Cached API data — only re-fetched when route or date changes
  const tidalCacheRef = useRef<TidalRouteCache | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchWeather = useCallback(
    async (timeStr: string, dateStr: string) => {
      try {
        const time = parseDeparture(timeStr, dateStr);
        const forecasts = await fetchWindForecast(latitude, longitude);
        setWeather(interpolateWind(forecasts, time));
      } catch {
        setWeather(null);
      }
    },
    [],
  );

  useEffect(() => {
    fetchWeather(departureTime, departureDate);
  }, [departureTime, departureDate, fetchWeather]);

  /**
   * Fetch tidal/wind data from APIs — only needed when route coords or date changes.
   * After fetching, recomputes the result with current params.
   */
  const fetchAndCompute = useCallback(
    async (coords: number[][], dateStr: string, timeStr: string, speed: number, vessel: VesselType) => {
      if (coords.length < 2) return;
      setTidalLoading(true);
      try {
        const departure = parseDeparture(timeStr, dateStr);
        const cache = await fetchTidalData(coords, departure);
        tidalCacheRef.current = cache;
        const result = recomputeTidalRoute(cache, departure, speed, vessel);
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

  /**
   * Recompute from cached data — no API calls.
   * Used when time, speed, or vessel type changes.
   */
  const recompute = useCallback(
    (timeStr: string, dateStr: string, speed: number, vessel: VesselType) => {
      const cache = tidalCacheRef.current;
      if (!cache) return;
      const departure = parseDeparture(timeStr, dateStr);
      const result = recomputeTidalRoute(cache, departure, speed, vessel);
      setTidalResult(result);
    },
    [],
  );

  /** Debounced recompute — for slider and input changes */
  const debouncedRecompute = useCallback(
    (timeStr: string, dateStr: string, speed: number, vessel: VesselType) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        recompute(timeStr, dateStr, speed, vessel);
      }, 300);
    },
    [recompute],
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

        // Route changed — need fresh API data
        fetchAndCompute(routeCoordsRef.current, departureDate, departureTime, speedKnots, vesselType);
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
    tidalCacheRef.current = null;
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
          debouncedRecompute(departureTime, departureDate, speed, vesselType);
        }}
        departureTime={departureTime}
        onDepartureTimeChange={(time) => {
          setDepartureTime(time);
          debouncedRecompute(time, departureDate, speedKnots, vesselType);
        }}
        departureDate={departureDate}
        onDepartureDateChange={(date) => {
          setDepartureDate(date);
          // Date change needs fresh API data
          fetchAndCompute(routeCoordsRef.current, date, departureTime, speedKnots, vesselType);
        }}
        vesselType={vesselType}
        onVesselTypeChange={(vessel) => {
          setVesselType(vessel);
          recompute(departureTime, departureDate, speedKnots, vessel);
        }}
        weather={weather}
      />
      <Map
        id="routeMap"
        initialViewState={{ latitude, longitude, zoom }}
        style={{ height: "100vh", width: "100%" }}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
        onLoad={(e) => onLoad(e)}
        onClick={handleClick}
      >
        {waypoints.map((waypoint, i) => (
          <Marker
            key={waypoint.id}
            longitude={waypoint.lng}
            latitude={waypoint.lat}
          >
            <div className="flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold shadow">
              {i + 1}
            </div>
          </Marker>
        ))}
      </Map>
    </div>
  );
}
