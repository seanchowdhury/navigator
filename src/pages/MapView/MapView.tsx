import MapGL, { Marker, useMap } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  GeoJSONSource,
  Map as MapLibreMap,
  MapLayerMouseEvent,
  MapLibreEvent,
  Point as PointLike,
} from "maplibre-gl";
import React, { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { Waypoint, GraphNode, GraphEdge } from "./MapView.types";
import RouteInfo from "./components/RouteInfo";
import GraphEditor, { GraphMode, GraphSelection } from "./components/GraphEditor";
import {
  fetchTidalData,
  recomputeTidalRoute,
  sweepDepartures,
  TidalRouteResult,
  TidalRouteCache,
  TripOptions,
  VesselType,
} from "../../services/tidalRoute";
import {
  fetchWindForecast,
  interpolateWind,
  WindForecast,
} from "../../services/nws";
import {
  DEFAULT_REGION,
  Region,
  REGIONS,
  RouteNote,
  regionAt,
  regionById,
  regionsInBounds,
} from "../../regions";
import { toDateInputValue, toTimeInputValue, zonedDateTime } from "../../lib/time";
import { WorkerRequest, WorkerResponse } from "../../workers/navigator.messages";

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

/** Below this zoom, panning doesn't download region graphs. */
const REGION_LOAD_MIN_ZOOM = 9;
/** Load regions this fraction of a screen outside the view, so they're ready on arrival. */
const REGION_PREFETCH_MARGIN = 0.5;

type RegionStatus =
  | { state: "loading"; loaded: number; total: number | null }
  | { state: "ready" }
  | { state: "error"; message: string };

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

  // Stretches where current/wind outrun the boat, drawn over the route.
  map.addSource("route-stalls", {
    type: "geojson",
    data: { type: "FeatureCollection", features: [] },
  });
  map.addLayer({
    id: "route-stalls-line",
    type: "line",
    source: "route-stalls",
    paint: { "line-color": "#dc2626", "line-width": 4 },
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

/** The region's notes whose point is within its radius of any route coordinate ([lng, lat]). */
function notesAlongRoute(region: Region, routeCoords: number[][]): RouteNote[] {
  return (region.routeNotes ?? []).filter((note) =>
    routeCoords.some(([lng, lat]) => haversineMeters(lat, lng, note.lat, note.lng) <= note.radiusM),
  );
}

/**
 * Bottom-center status: a notice if there is one, otherwise the active region's
 * graph download progress or error. Hidden once the region is ready.
 */
function RegionStatusPill({
  region,
  status,
  notice,
  onRetry,
}: {
  region: Region | null;
  status: RegionStatus | undefined;
  notice: string | null;
  onRetry: () => void;
}) {
  let content: React.ReactNode = null;
  if (notice) {
    content = notice;
  } else if (region && status?.state === "loading") {
    const pct = status.total ? Math.round((status.loaded / status.total) * 100) : null;
    content = `Loading ${region.name} water map…${pct !== null ? ` ${pct}%` : ""}`;
  } else if (region && status?.state === "error") {
    content = (
      <>
        Couldn't load the {region.name} water map.{" "}
        <button type="button" className="underline font-medium" onClick={onRetry}>
          Retry
        </button>
      </>
    );
  }
  if (!content) return null;
  return (
    <div
      role="status"
      className="absolute left-1/2 -translate-x-1/2 z-10 rounded-full border border-border bg-background/95 text-foreground shadow-md text-sm"
      style={{ bottom: "calc(1.5rem + env(safe-area-inset-bottom, 0px))", padding: "6px 14px" }}
    >
      {content}
    </div>
  );
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


export default function MapView() {
  const workerRef = useRef<Worker | null>(null);

  const { routeMap } = useMap();
  const [waypoints, setWaypoints] = useState<Waypoint[]>([]);

  const routeCoordsRef = useRef<number[][]>([]);
  const [totalDistance, setTotalDistance] = useState(0);
  // Waypoint positions within routeCoordsRef, so stops line up with the route.
  const waypointCoordIndicesRef = useRef<number[]>([]);
  const [tidalLoading, setTidalLoading] = useState(false);

  // --- Regions ---
  // A route belongs to the region its first waypoint is in; otherwise the region
  // in view (or the default) sets the time zone and weather location.
  const [routeRegionId, setRouteRegionId] = useState<string | null>(null);
  const [viewRegionId, setViewRegionId] = useState<string | null>(null);
  const [regionStatus, setRegionStatus] = useState<Record<string, RegionStatus>>({});
  const activeRegion: Region =
    regionById(routeRegionId ?? viewRegionId ?? "") ?? DEFAULT_REGION;
  const timezone = activeRegion.timezone;
  /** Region notes (e.g. locks) the current route passes near. */
  const [routeNotes, setRouteNotes] = useState<RouteNote[]>([]);
  /** Short-lived message, e.g. for a click outside every region. */
  const [notice, setNotice] = useState<string | null>(null);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [speedKnots, setSpeedKnots] = useState(3);
  const [departureTime, setDepartureTime] = useState(() =>
    toTimeInputValue(new Date(), DEFAULT_REGION.timezone),
  );
  const [departureDate, setDepartureDate] = useState(() =>
    toDateInputValue(new Date(), DEFAULT_REGION.timezone),
  );
  const [vesselType, setVesselType] = useState<VesselType>("whitehall_gig");
  const [weather, setWeather] = useState<WindForecast | null>(null);
  const [roundTrip, setRoundTrip] = useState(false);

  /** The departure instant: the entered date and time on the region's wall clock. */
  const departure = zonedDateTime(departureDate, departureTime, timezone);

  // Latest values for the worker's onmessage (created once), which would otherwise
  // capture the initial ones.
  const departureDateRef = useRef(departureDate);
  departureDateRef.current = departureDate;
  const activeRegionRef = useRef(activeRegion);
  activeRegionRef.current = activeRegion;

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
  const [tidalCache, setTidalCache] = useState<TidalRouteCache | null>(null);
  const fetchIdRef = useRef(0);

  // Weather at the route's start, or the region's center before there's a route.
  const weatherLat = waypoints[0]?.lat ?? activeRegion.center.lat;
  const weatherLng = waypoints[0]?.lng ?? activeRegion.center.lng;
  const departureMs = departure.getTime();
  useEffect(() => {
    let cancelled = false;
    fetchWindForecast(weatherLat, weatherLng)
      .then((forecasts) => {
        if (!cancelled) setWeather(interpolateWind(forecasts, new Date(departureMs)));
      })
      .catch(() => {
        if (!cancelled) setWeather(null);
      });
    return () => {
      cancelled = true;
    };
  }, [weatherLat, weatherLng, departureMs]);

  /** Fetch tidal/wind data from APIs — only needed when the route or date changes. */
  const fetchTides = useCallback(async (
    coords: number[][],
    waypointIndices: number[],
    dateStr: string,
    region: Region,
  ) => {
    if (coords.length < 2) return;
    // Ignore responses from fetches that a newer one has superseded.
    const fetchId = ++fetchIdRef.current;
    setTidalLoading(true);
    try {
      // Predictions start at local midnight of the departure date in the region.
      const dayStart = zonedDateTime(dateStr, "00:00", region.timezone);
      const cache = await fetchTidalData(coords, dayStart, waypointIndices, region.nonTidalAreas);
      if (fetchId === fetchIdRef.current) setTidalCache(cache);
    } catch (e) {
      console.error("Tidal calculation failed:", e);
      if (fetchId === fetchIdRef.current) setTidalCache(null);
    } finally {
      if (fetchId === fetchIdRef.current) setTidalLoading(false);
    }
  }, []);

  const trip = useMemo<TripOptions>(
    () => ({
      roundTrip,
      stopMinutes: waypoints.map((w) => w.stopMinutes),
      returnStopMinutes: waypoints.map((w) => w.returnStopMinutes),
    }),
    [roundTrip, waypoints],
  );

  // Pure math over the cached data, so it's cheap to redo on every input change.
  const tidalResult = useMemo<TidalRouteResult | null>(
    () =>
      tidalCache
        ? recomputeTidalRoute(tidalCache, new Date(departureMs), speedKnots, vesselType, trip)
        : null,
    [tidalCache, departureMs, speedKnots, vesselType, trip],
  );

  /** Runs the best-departure sweep over a window on the selected date. */
  const sweepDepartureWindow = useCallback(
    (windowStart: string, windowEnd: string) => {
      if (!tidalCache) return null;
      return sweepDepartures(
        tidalCache,
        zonedDateTime(departureDate, windowStart, timezone),
        zonedDateTime(departureDate, windowEnd, timezone),
        speedKnots,
        vesselType,
        trip,
      );
    },
    [tidalCache, departureDate, timezone, speedKnots, vesselType, trip],
  );

  function showNotice(message: string) {
    setNotice(message);
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = setTimeout(() => setNotice(null), 4000);
  }

  // Messages wait here until the worker reports it's ready (see "workerReady").
  const workerReadyRef = useRef(false);
  const workerQueueRef = useRef<WorkerRequest[]>([]);
  function postToWorker(message: WorkerRequest) {
    if (workerRef.current && workerReadyRef.current) workerRef.current.postMessage(message);
    else workerQueueRef.current.push(message);
  }

  /** Starts downloading a region's graph unless it's loaded or loading. */
  const regionStatusRef = useRef(regionStatus);
  regionStatusRef.current = regionStatus;
  function ensureRegionLoaded(region: Region) {
    const status = regionStatusRef.current[region.id];
    if (status && status.state !== "error") return;
    const loading: RegionStatus = { state: "loading", loaded: 0, total: null };
    regionStatusRef.current = { ...regionStatusRef.current, [region.id]: loading };
    setRegionStatus((prev) => ({ ...prev, [region.id]: loading }));
    postToWorker({
      type: "loadRegion",
      regionId: region.id,
      url: region.graphUrl,
      minComponentNodes: region.minComponentNodes ?? 0,
    });
  }

  /** Called when the map settles: note the region in view and prefetch nearby graphs. */
  function updateRegionsInView(map: MapLibreMap) {
    const center = map.getCenter();
    setViewRegionId(regionAt(center.lat, center.lng)?.id ?? null);
    if (map.getZoom() < REGION_LOAD_MIN_ZOOM) return;

    const bounds = map.getBounds();
    const padLng = (bounds.getEast() - bounds.getWest()) * REGION_PREFETCH_MARGIN;
    const padLat = (bounds.getNorth() - bounds.getSouth()) * REGION_PREFETCH_MARGIN;
    regionsInBounds([
      bounds.getWest() - padLng,
      bounds.getSouth() - padLat,
      bounds.getEast() + padLng,
      bounds.getNorth() + padLat,
    ]).forEach(ensureRegionLoaded);
  }

  // Route-leg requests in flight: requestId -> the waypoint the leg ends at.
  const nextRequestIdRef = useRef(1);
  const pendingLegsRef = useRef(new Map<number, string>());
  /** Waypoints dropped after a failed leg; late results for them are ignored. */
  const droppedWaypointIdsRef = useRef(new Set<string>());
  // Dev graph editor requests: requestId -> resolver.
  const pendingGraphsRef = useRef(
    new Map<number, { resolve: (json: string) => void; reject: (e: Error) => void }>(),
  );

  useEffect(() => {
    if (!routeMap) return;
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL("../../workers/navigator.worker.ts", import.meta.url),
        { type: "module" },
      );
      workerRef.current.onmessage = (e: MessageEvent<WorkerResponse>) => {
        const message = e.data;
        switch (message.type) {
          case "workerReady":
            workerReadyRef.current = true;
            workerQueueRef.current.forEach((queued) => workerRef.current?.postMessage(queued));
            workerQueueRef.current = [];
            return;
          case "regionProgress":
            setRegionStatus((prev) => ({
              ...prev,
              [message.regionId]: { state: "loading", loaded: message.loaded, total: message.total },
            }));
            return;
          case "regionReady":
            setRegionStatus((prev) => ({ ...prev, [message.regionId]: { state: "ready" } }));
            return;
          case "regionError":
            setRegionStatus((prev) => ({
              ...prev,
              [message.regionId]: { state: "error", message: message.message },
            }));
            return;
          case "graph":
          case "graphError": {
            const pending = pendingGraphsRef.current.get(message.requestId);
            pendingGraphsRef.current.delete(message.requestId);
            if (message.type === "graph") pending?.resolve(message.json);
            else pending?.reject(new Error(message.message));
            return;
          }
          case "routeError": {
            const waypointId = pendingLegsRef.current.get(message.requestId);
            pendingLegsRef.current.delete(message.requestId);
            if (!waypointId || droppedWaypointIdsRef.current.has(waypointId)) return;
            // Drop the waypoint this leg ends at (and any placed after it, whose legs
            // started from it) so the route stays consistent.
            setWaypoints((prev) => {
              const index = prev.findIndex((w) => w.id === waypointId);
              if (index === -1) return prev;
              prev.slice(index).forEach((w) => droppedWaypointIdsRef.current.add(w.id));
              return prev.slice(0, index);
            });
            showNotice(`Couldn't route there: ${message.message}`);
            return;
          }
          case "route":
            break;
        }

        const waypointId = pendingLegsRef.current.get(message.requestId);
        pendingLegsRef.current.delete(message.requestId);
        if (!waypointId || droppedWaypointIdsRef.current.has(waypointId)) return;

        const { coords: rawCoords, distance } = message;
        const coords: number[][] = [];
        for (let i = 0; i < rawCoords.length; i += 2) {
          coords.push([rawCoords[i + 1], rawCoords[i]]);
        }
        // The first leg places waypoint 0 too; every leg ends at the next waypoint.
        if (routeCoordsRef.current.length === 0) waypointCoordIndicesRef.current = [0];
        routeCoordsRef.current = [...routeCoordsRef.current, ...coords];
        waypointCoordIndicesRef.current = [
          ...waypointCoordIndicesRef.current,
          routeCoordsRef.current.length - 1,
        ];
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

        setRouteNotes(notesAlongRoute(activeRegionRef.current, routeCoordsRef.current));

        // Route changed — need fresh API data
        fetchTides(
          routeCoordsRef.current,
          waypointCoordIndicesRef.current,
          departureDateRef.current,
          activeRegionRef.current,
        );
      };

      // The map starts in the default region; load it and anything else in view.
      updateRegionsInView(routeMap.getMap());
    }
    // updateRegionsInView/showNotice only touch refs and state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeMap, fetchTides]);

  // Route each new leg once. waypoints also changes when a stop time is edited,
  // which must not re-route anything.
  const routedWaypointCountRef = useRef(0);
  useEffect(() => {
    if (waypoints.length < routedWaypointCountRef.current) {
      routedWaypointCountRef.current = waypoints.length; // route was cleared
    }
    if (waypoints.length < 2 || waypoints.length === routedWaypointCountRef.current) return;
    if (!workerRef.current || !routeRegionId) return;

    routedWaypointCountRef.current = waypoints.length;
    const from = waypoints[waypoints.length - 2];
    const to = waypoints[waypoints.length - 1];
    const requestId = nextRequestIdRef.current++;
    pendingLegsRef.current.set(requestId, to.id);
    postToWorker({
      type: "route",
      requestId,
      regionId: routeRegionId,
      from: { lat: from.lat, lng: from.lng },
      to: { lat: to.lat, lng: to.lng },
    });
  }, [waypoints, routeMap, routeRegionId]);

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

  useEffect(() => {
    const source = routeMap?.getSource("route-stalls") as GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: (tidalResult?.stalls ?? []).map((segment) => ({
        type: "Feature",
        properties: { netSpeed: segment.netSpeed },
        geometry: { type: "LineString", coordinates: [segment.from, segment.to] },
      })),
    });
  }, [routeMap, tidalResult]);

  function handleClick(e: MapLayerMouseEvent) {
    if (!routeMap) return;

    if (graphEditMode) {
      handleGraphClick(e);
      return;
    }

    if (!workerRef.current) return;
    const features = routeMap?.queryRenderedFeatures(e.point);
    if (!features?.some((feature) => feature.layer.id == "water")) return;

    const { lat, lng } = e.lngLat;
    const region = regionAt(lat, lng);
    if (!region) {
      showNotice("Routing isn't available here yet.");
      return;
    }
    if (routeRegionId && region.id !== routeRegionId) {
      showNotice(`This route is in ${activeRegion.name}; clear it to plan in ${region.name}.`);
      return;
    }
    // Usually already loaded from panning; legs placed while it loads wait in the worker.
    ensureRegionLoaded(region);
    if (!routeRegionId) setRouteRegionId(region.id);
    addWaypoint({ lat, lng });
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
      // The worker already has the region's graph; ask it for a JSON copy.
      ensureRegionLoaded(activeRegion);
      const requestId = nextRequestIdRef.current++;
      const json = await new Promise<string>((resolve, reject) => {
        pendingGraphsRef.current.set(requestId, { resolve, reject });
        postToWorker({ type: "getGraph", requestId, regionId: activeRegion.id });
      });
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
      {
        id: crypto.randomUUID(),
        lat,
        lng,
        label: `${prev.length + 1}`,
        stopMinutes: 0,
        returnStopMinutes: 0,
      },
    ]);
  }

  /** "15m", "15m / 10m back", or null, for the waypoint's marker. */
  function stopBadge(waypoint: Waypoint, index: number) {
    const last = waypoints.length - 1;
    const out = index > 0 && (index < last || roundTrip) ? waypoint.stopMinutes : 0;
    const back = roundTrip && index > 0 && index < last ? waypoint.returnStopMinutes : 0;
    if (!out && !back) return null;
    if (!back) return `${out}m`;
    if (!out) return `${back}m back`;
    return `${out}m / ${back}m back`;
  }

  function updateStop(waypointId: string, direction: "out" | "back", minutes: number) {
    setWaypoints((prev) =>
      prev.map((w) =>
        w.id !== waypointId
          ? w
          : direction === "out"
            ? { ...w, stopMinutes: minutes }
            : { ...w, returnStopMinutes: minutes },
      ),
    );
  }

  function clearRoute() {
    setWaypoints([]);
    setRouteRegionId(null);
    setRouteNotes([]);
    pendingLegsRef.current.clear();
    setTotalDistance(0);
    fetchIdRef.current++; // drop any in-flight tide fetch
    setTidalCache(null);
    setTidalLoading(false);
    routeCoordsRef.current = [];
    waypointCoordIndicesRef.current = [];
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
        }}
        departureTime={departureTime}
        onDepartureTimeChange={(time) => {
          setDepartureTime(time);
        }}
        departureDate={departureDate}
        onDepartureDateChange={(date) => {
          setDepartureDate(date);
          // Date change needs fresh API data
          fetchTides(routeCoordsRef.current, waypointCoordIndicesRef.current, date, activeRegion);
        }}
        vesselType={vesselType}
        onVesselTypeChange={(vessel) => {
          setVesselType(vessel);
        }}
        roundTrip={roundTrip}
        onRoundTripChange={setRoundTrip}
        waypoints={waypoints}
        onStopChange={updateStop}
        weather={weather}
        onSweepDepartures={sweepDepartureWindow}
        departure={departure}
        timezone={timezone}
        regions={REGIONS}
        selectedRegionId={viewRegionId ?? activeRegion.id}
        onRegionSelect={(id) => {
          const region = regionById(id);
          if (!region) return;
          ensureRegionLoaded(region);
          setViewRegionId(region.id);
          routeMap?.flyTo({ center: [region.center.lng, region.center.lat], zoom: region.zoom });
        }}
        routeNotes={routeNotes}
      />
      <RegionStatusPill
        region={regionStatus[activeRegion.id] ? activeRegion : null}
        status={regionStatus[activeRegion.id]}
        notice={notice}
        onRetry={() => ensureRegionLoaded(activeRegion)}
      />
      <MapGL
        id="routeMap"
        initialViewState={{
          latitude: DEFAULT_REGION.center.lat,
          longitude: DEFAULT_REGION.center.lng,
          zoom: DEFAULT_REGION.zoom,
        }}
        style={{ height: "100dvh", width: "100%" }}
        mapStyle="https://tiles.openfreemap.org/styles/liberty"
        onLoad={(e) => onLoad(e)}
        onMoveEnd={(e) => updateRegionsInView(e.target)}
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
            <div className="relative flex items-center justify-center w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-bold shadow">
              {i + 1}
              {stopBadge(waypoint, i) && (
                <span className="absolute left-full ml-1 whitespace-nowrap rounded bg-background text-foreground border border-border px-1 text-[10px] font-medium shadow-sm">
                  {stopBadge(waypoint, i)}
                </span>
              )}
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
