import { find_route, get_graph, load_region } from "navigator_core";
import { WorkerRequest, WorkerResponse } from "./navigator.messages";

/** One load per region; route requests for a region wait on its promise. */
const regionLoads = new Map<string, Promise<void>>();

function send(message: WorkerResponse) {
  postMessage(message);
}

function errorMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

async function downloadGraph(regionId: string, url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Graph download failed (${res.status})`);
  const header = res.headers.get("content-length");
  const total = header ? Number(header) : null;

  // Stream so the page can show progress for larger regions.
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    send({ type: "regionProgress", regionId, loaded, total });
  }

  const bytes = new Uint8Array(loaded);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return isGzip(bytes) ? gunzip(bytes) : bytes;
}

/**
 * Graphs ship as .bin.gz. Check the bytes rather than the URL: a server that adds
 * Content-Encoding: gzip would have the browser decompress them already.
 */
function isGzip(bytes: Uint8Array) {
  return bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function gunzip(bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function loadRegion(regionId: string, url: string, minComponentNodes: number): Promise<void> {
  const existing = regionLoads.get(regionId);
  if (existing) return existing;

  const load = downloadGraph(regionId, url).then((bytes) =>
    load_region(regionId, bytes, minComponentNodes),
  );
  regionLoads.set(regionId, load);
  load.then(
    () => send({ type: "regionReady", regionId }),
    (e) => {
      regionLoads.delete(regionId); // allow a retry
      send({ type: "regionError", regionId, message: errorMessage(e) });
    },
  );
  return load;
}

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const request = e.data;
  switch (request.type) {
    case "loadRegion":
      loadRegion(request.regionId, request.url, request.minComponentNodes).catch(() => {}); // reported via regionError
      break;

    case "route": {
      const { requestId, regionId, from, to } = request;
      try {
        const load = regionLoads.get(regionId);
        // Missing if it was never requested or its download failed (failed loads are
        // forgotten so they can be retried).
        if (!load) throw new Error("the water map for this area isn't loaded");
        await load; // route requests made while the graph downloads wait here
        const result = Array.from(find_route(regionId, from.lat, from.lng, to.lat, to.lng));
        if (result.length < 3) throw new Error("No water route between these points");
        const distance = result.pop()!;
        send({ type: "route", requestId, coords: smoothCoords(result, 5), distance });
      } catch (err) {
        send({ type: "routeError", requestId, message: errorMessage(err) });
      }
      break;
    }

    case "getGraph": {
      const { requestId, regionId } = request;
      try {
        await regionLoads.get(regionId);
        send({ type: "graph", requestId, json: get_graph(regionId) });
      } catch (err) {
        send({ type: "graphError", requestId, message: errorMessage(err) });
      }
      break;
    }
  }
};

// The handler is installed only after the WASM import's top-level await, so tell
// the page it can start sending (anything sent earlier would have been dropped).
send({ type: "workerReady" });

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
