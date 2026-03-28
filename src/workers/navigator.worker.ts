import init, { find_route } from "navigator_core";

await init();

onmessage = (e: MessageEvent<Float64Array[]>) => {
  const result = find_route(e.data[0], e.data[1]);
  postMessage(result);
};
