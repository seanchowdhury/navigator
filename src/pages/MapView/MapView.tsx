import MapGL, { Marker, useMap } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapLibreEvent,
  Point as PointLike,
} from "maplibre-gl";
import { useEffect, useRef, useState, useCallback } from "react";
import { Waypoint, GraphNode, GraphEdge } from "./MapView.types";
import RouteInfo from "./components/RouteInfo";
import GraphEditor, { GraphMode, GraphSelection } from "./components/GraphEditor";
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

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const r = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return r * 2 * Math.asin(Math.sqrt(a));
}

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

  map.addSource("graph-edges", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "graph-edges-layer",
    type: "line",
    source: "graph-edges",
    paint: {
      "line-color": ["case", ["get", "selected"], "#f59e0b", "#059669"],
      "line-width": ["case", ["get", "selected"], 3, 1],
      "line-opacity": 0.6,
    },
  });

  map.addSource("graph-nodes", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "graph-nodes-layer",
    type: "circle",
    source: "graph-nodes",
    paint: {
      "circle-radius": ["case", ["get", "selected"], 6, 3],
      "circle-color": ["case", ["get", "selected"], "#f59e0b", "#059669"],
      "circle-stroke-width": 1,
      "circle-stroke-color": "#065f46",
    },
  });
}

const NODE_HIT_RADIUS_PX = 8;

/** Returns the id of the graph node closest to `point`, within NODE_HIT_RADIUS_PX. */
function graphNodeIdNear(map: MapLibreMap, point: PointLike): number | null {
  const { x, y } = point;
  const features = map.queryRenderedFeatures(
    [
      [x - NODE_HIT_RADIUS_PX, y - NODE_HIT_RADIUS_PX],
      [x + NODE_HIT_RADIUS_PX, y + NODE_HIT_RADIUS_PX],
    ],
    { layers: ["graph-nodes-layer"] },
  );
  let bestId: number | null = null;
  let bestDist = Infinity;
  for (const f of features) {
    if (f.geometry.type !== "Point") continue;
    const p = map.project(f.geometry.coordinates as [number, number]);
    const dist = Math.hypot(p.x - x, p.y - y);
    if (dist < bestDist) {
      bestDist = dist;
      bestId = f.properties!.id as number;
    }
  }
  return bestId;
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

  // --- Water graph view/edit state ---
  const graphNodesRef = useRef<Map<number, GraphNode>>(new Map());
  const graphEdgesRef = useRef<GraphEdge[]>([]);
  const nextGraphNodeIdRef = useRef(0);
  const [graphLoaded, setGraphLoaded] = useState(false);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphVersion, setGraphVersion] = useState(0);
  const [graphDirty, setGraphDirty] = useState(false);
  const [graphEditMode, setGraphEditMode] = useState(false);
  const [graphMode, setGraphMode] = useState<GraphMode>("select");
  const [linkFromId, setLinkFromId] = useState<number | null>(null);
  const [graphSelection, setGraphSelection] = useState<GraphSelection>(null);
  const boxStartRef = useRef<{ x: number; y: number } | null>(null);
  const [selectionBox, setSelectionBox] = useState<
    { x1: number; y1: number; x2: number; y2: number } | null
  >(null);

  const bumpGraph = useCallback((dirty = true) => {
    setGraphVersion((v) => v + 1);
    if (dirty) setGraphDirty(true);
  }, []);

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

  useEffect(() => {
    if (!routeMap) return;
    const nodesSource = routeMap.getSource("graph-nodes") as GeoJSONSource | undefined;
    const edgesSource = routeMap.getSource("graph-edges") as GeoJSONSource | undefined;
    if (!nodesSource || !edgesSource) return;

    const selectedNodeIds = new Set(graphSelection?.type === "nodes" ? graphSelection.ids : []);
    nodesSource.setData({
      type: "FeatureCollection",
      features: Array.from(graphNodesRef.current.values()).map((n) => ({
        type: "Feature",
        properties: {
          id: n.id,
          shore_distance: n.shore_distance,
          selected: selectedNodeIds.has(n.id),
        },
        geometry: { type: "Point", coordinates: [n.lng, n.lat] },
      })),
    });

    const edgeFeatures = graphEdgesRef.current
      .map((edge, index) => {
        const from = graphNodesRef.current.get(edge.from);
        const to = graphNodesRef.current.get(edge.to);
        if (!from || !to) return null;
        return {
          type: "Feature" as const,
          properties: {
            index,
            distance: edge.distance,
            selected: graphSelection?.type === "edge" && graphSelection.index === index,
          },
          geometry: {
            type: "LineString" as const,
            coordinates: [
              [from.lng, from.lat],
              [to.lng, to.lat],
            ],
          },
        };
      })
      .filter((f): f is NonNullable<typeof f> => f !== null);

    edgesSource.setData({ type: "FeatureCollection", features: edgeFeatures });
  }, [routeMap, graphVersion, graphSelection]);

  function handleClick(e: MapLayerMouseEvent) {
    if (!routeMap) return;

    if (graphEditMode) {
      handleGraphClick(e);
      return;
    }

    if (!workerRef.current) return;
    const features = routeMap?.queryRenderedFeatures(e.point);
    if (features?.some((feature) => feature.layer.id == "water")) {
      addWaypoint({ lat: e.lngLat.lat, lng: e.lngLat.lng });
    } else {
      return;
    }
  }

  function handleGraphClick(e: MapLayerMouseEvent) {
    if (!routeMap) return;

    if (graphMode === "add-node") {
      addGraphNode(e.lngLat.lat, e.lngLat.lng);
      return;
    }

    const nodeId = graphNodeIdNear(e.target, e.point);

    if (graphMode === "link") {
      if (nodeId === null) return;
      linkGraphNode(nodeId);
      return;
    }

    // select mode
    // Shift+click is handled on mouseup by the box-select handlers.
    if (e.originalEvent.shiftKey) return;
    const additive = e.originalEvent.metaKey || e.originalEvent.ctrlKey;
    const [edgeFeature] = e.target.queryRenderedFeatures(e.point, {
      layers: ["graph-edges-layer"],
    });
    if (nodeId !== null) {
      const id = nodeId;
      if (additive) {
        toggleSelectedGraphNodes([id]);
      } else {
        setGraphSelection({ type: "nodes", ids: [id] });
      }
    } else if (additive) {
      // Modifier-click on empty space keeps the current selection.
      return;
    } else if (edgeFeature) {
      setGraphSelection({ type: "edge", index: edgeFeature.properties!.index as number });
    } else {
      setGraphSelection(null);
    }
  }

  /** Toggles each id in/out of the current node selection. */
  function toggleSelectedGraphNodes(ids: number[]) {
    setGraphSelection((prev) => {
      const next = new Set(prev?.type === "nodes" ? prev.ids : []);
      for (const id of ids) {
        if (next.has(id)) next.delete(id);
        else next.add(id);
      }
      return next.size > 0 ? { type: "nodes", ids: Array.from(next) } : null;
    });
  }

  /** Adds each id to the current node selection. */
  function addSelectedGraphNodes(ids: number[]) {
    setGraphSelection((prev) => {
      const next = new Set(prev?.type === "nodes" ? prev.ids : []);
      ids.forEach((id) => next.add(id));
      return next.size > 0 ? { type: "nodes", ids: Array.from(next) } : null;
    });
  }

  // Shift+drag box selection (select mode only). Box-zoom is disabled while editing.
  function handleGraphMouseDown(e: MapLayerMouseEvent) {
    if (!graphEditMode || graphMode !== "select" || !e.originalEvent.shiftKey) return;
    e.target.dragPan.disable();
    boxStartRef.current = { x: e.point.x, y: e.point.y };
    setSelectionBox({ x1: e.point.x, y1: e.point.y, x2: e.point.x, y2: e.point.y });
  }

  function handleGraphMouseMove(e: MapLayerMouseEvent) {
    const start = boxStartRef.current;
    if (!start) return;
    setSelectionBox({ x1: start.x, y1: start.y, x2: e.point.x, y2: e.point.y });
  }

  function handleGraphMouseUp(e: MapLayerMouseEvent) {
    const start = boxStartRef.current;
    if (!start) return;
    boxStartRef.current = null;
    setSelectionBox(null);
    e.target.dragPan.enable();

    // A tiny box is really a shift+click: toggle the nearest node.
    if (Math.abs(e.point.x - start.x) < 4 && Math.abs(e.point.y - start.y) < 4) {
      const id = graphNodeIdNear(e.target, e.point);
      if (id !== null) toggleSelectedGraphNodes([id]);
      return;
    }

    const features = e.target.queryRenderedFeatures(
      [
        [Math.min(start.x, e.point.x), Math.min(start.y, e.point.y)],
        [Math.max(start.x, e.point.x), Math.max(start.y, e.point.y)],
      ],
      { layers: ["graph-nodes-layer"] },
    );
    addSelectedGraphNodes(features.map((f) => f.properties!.id as number));
  }

  async function loadGraph() {
    setGraphLoading(true);
    try {
      // Imported lazily so production (where the editor is hidden) doesn't
      // instantiate the WASM module on the main thread.
      const { get_graph } = await import("navigator_core");
      const json = get_graph();
      const parsed = JSON.parse(json) as {
        nodes: { lat: number; lng: number; shore_distance: number }[];
        edges: { from: number; to: number; distance: number }[];
      };
      const nodeMap = new Map<number, GraphNode>();
      parsed.nodes.forEach((n, i) =>
        nodeMap.set(i, { id: i, lat: n.lat, lng: n.lng, shore_distance: n.shore_distance }),
      );
      graphNodesRef.current = nodeMap;
      graphEdgesRef.current = parsed.edges.map((e) => ({
        from: e.from,
        to: e.to,
        distance: e.distance,
      }));
      nextGraphNodeIdRef.current = parsed.nodes.length;
      setGraphLoaded(true);
      setGraphDirty(false);
      setGraphSelection(null);
      bumpGraph(false);
    } finally {
      setGraphLoading(false);
    }
  }

  function addGraphNode(lat: number, lng: number) {
    const id = nextGraphNodeIdRef.current++;
    graphNodesRef.current.set(id, { id, lat, lng, shore_distance: 0 });
    setGraphSelection({ type: "nodes", ids: [id] });
    setGraphMode("select");
    bumpGraph();
  }

  function linkGraphNode(id: number) {
    if (linkFromId === null) {
      setLinkFromId(id);
      return;
    }
    if (linkFromId === id) {
      setLinkFromId(null);
      return;
    }
    const from = graphNodesRef.current.get(linkFromId);
    const to = graphNodesRef.current.get(id);
    if (from && to) {
      graphEdgesRef.current.push({
        from: linkFromId,
        to: id,
        distance: haversineMeters(from.lat, from.lng, to.lat, to.lng),
      });
      bumpGraph();
    }
    setLinkFromId(null);
  }

  function updateSelectedGraphNode(
    patch: Partial<Pick<GraphNode, "lat" | "lng" | "shore_distance">>,
  ) {
    if (graphSelection?.type !== "nodes" || graphSelection.ids.length !== 1) return;
    const nodeId = graphSelection.ids[0];
    const node = graphNodesRef.current.get(nodeId);
    if (!node) return;
    const updated = { ...node, ...patch };
    graphNodesRef.current.set(nodeId, updated);

    // Keep incident edge distances in sync when the node moves.
    if (patch.lat !== undefined || patch.lng !== undefined) {
      graphEdgesRef.current = graphEdgesRef.current.map((edge) => {
        if (edge.from !== nodeId && edge.to !== nodeId) return edge;
        const other = graphNodesRef.current.get(edge.from === nodeId ? edge.to : edge.from);
        if (!other) return edge;
        return {
          ...edge,
          distance: haversineMeters(updated.lat, updated.lng, other.lat, other.lng),
        };
      });
    }
    bumpGraph();
  }

  function deleteGraphSelection() {
    if (!graphSelection) return;
    if (graphSelection.type === "nodes") {
      const ids = new Set(graphSelection.ids);
      ids.forEach((id) => graphNodesRef.current.delete(id));
      graphEdgesRef.current = graphEdgesRef.current.filter(
        (edge) => !ids.has(edge.from) && !ids.has(edge.to),
      );
    } else {
      graphEdgesRef.current = graphEdgesRef.current.filter(
        (_, index) => index !== graphSelection.index,
      );
    }
    setGraphSelection(null);
    bumpGraph();
  }

  function resetGraph() {
    setLinkFromId(null);
    loadGraph();
  }

  function exportGraph() {
    const entries = Array.from(graphNodesRef.current.entries()).sort((a, b) => a[0] - b[0]);
    const idRemap = new Map<number, number>();
    const nodes = entries.map(([oldId, n], newIndex) => {
      idRemap.set(oldId, newIndex);
      return { lat: n.lat, lng: n.lng, shore_distance: n.shore_distance };
    });
    const edges = graphEdgesRef.current
      .filter((e) => idRemap.has(e.from) && idRemap.has(e.to))
      .map((e) => ({
        from: idRemap.get(e.from)!,
        to: idRemap.get(e.to)!,
        distance: e.distance,
      }));

    const blob = new Blob([JSON.stringify({ nodes, edges })], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "graph.edited.json";
    a.click();
    URL.revokeObjectURL(url);
    setGraphDirty(false);
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

  const selectedGraphNode =
    graphSelection?.type === "nodes" && graphSelection.ids.length === 1
      ? graphNodesRef.current.get(graphSelection.ids[0]) ?? null
      : null;
  const selectedGraphEdge =
    graphSelection?.type === "edge" ? graphEdgesRef.current[graphSelection.index] ?? null : null;

  return (
    <div className="relative">
      {import.meta.env.DEV && (
        <GraphEditor
          loaded={graphLoaded}
          loading={graphLoading}
          editMode={graphEditMode}
          onToggleEditMode={() => {
            setGraphEditMode((prev) => !prev);
            setGraphMode("select");
            setLinkFromId(null);
            setGraphSelection(null);
          }}
          onLoad={loadGraph}
          onReset={resetGraph}
          onExport={exportGraph}
          dirty={graphDirty}
          nodeCount={graphNodesRef.current.size}
          edgeCount={graphEdgesRef.current.length}
          mode={graphMode}
          onModeChange={(mode) => {
            setGraphMode(mode);
            setLinkFromId(null);
          }}
          linkFromId={linkFromId}
          selection={graphSelection}
          selectedNode={selectedGraphNode}
          selectedEdge={selectedGraphEdge}
          onUpdateSelectedNode={updateSelectedGraphNode}
          onDeleteSelection={deleteGraphSelection}
          onClearSelection={() => setGraphSelection(null)}
        />
      )}
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
      <MapGL
        id="routeMap"
        initialViewState={{ latitude, longitude, zoom }}
        style={{ height: "100vh", width: "100%" }}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
        onLoad={(e) => onLoad(e)}
        onClick={handleClick}
        onMouseDown={handleGraphMouseDown}
        onMouseMove={handleGraphMouseMove}
        onMouseUp={handleGraphMouseUp}
        boxZoom={!graphEditMode}
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
      </MapGL>
      {selectionBox && (
        <div
          className="absolute pointer-events-none border-2 border-amber-500 bg-amber-500/10"
          style={{
            left: Math.min(selectionBox.x1, selectionBox.x2),
            top: Math.min(selectionBox.y1, selectionBox.y2),
            width: Math.abs(selectionBox.x2 - selectionBox.x1),
            height: Math.abs(selectionBox.y2 - selectionBox.y1),
          }}
        />
      )}
    </div>
  );
}
