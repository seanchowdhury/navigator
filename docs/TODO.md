# TODO

## Warn when the departure is beyond the wind forecast

NWS hourly forecasts cover about a week. `interpolateWind` in `src/services/nws.ts` falls back to the nearest forecast hour when none covers the requested time, so a trip three weeks out gets the last forecast hour's wind applied to every segment. `WeatherSection` and `FloatPlanCard` show that same hour's forecast with no caveat.

Wanted: no wind effect when the time is out of range, plus a notice telling the user that weather isn't being accounted for because the date is too far out.

To decide when building it:

- Past dates hit the same fallback.
- The weather panel and the share card use the same function, so both need the notice, not only the timing maths.
- A trip can start inside the forecast range and end outside it.

## Deduplicate graph edges

`navigator_offline/src/main.rs` writes every neighbour pair in both directions, and `Router::new` in `navigator_core/src/lib.rs` adds both directions again, so each neighbour is stored twice.

Emitting one direction cuts the shipped graphs by about 39%:

| Region | Edges stored | Unique pairs | Shipped size | Deduplicated |
|---|---|---|---|---|
| NYC | 251,247 | 125,685 | 1.10 MB | 0.68 MB |
| Seattle | 580,148 | 290,074 | 2.63 MB | 1.60 MB |

Don't rebuild NYC from OSM to fix this: its graph has hand edits from the graph editor that a rebuild would lose. No existing tool deduplicates a shipped file. `dump_graph` writes GeoJSON for viewing, not the `{nodes, edges}` JSON that `build_graph` reads, and the graph editor's export keeps duplicates as they are. The fix needs a deduplication step in `build_graph` (fed by the editor's export), plus a change to the offline builder so new regions only emit one direction.

## Tide-aware route choice

Where two points can be joined through more than one channel, the fastest channel depends on the current. Today the router picks by distance and shore penalty only.

Approach: have the router return two or three distinct routes (re-run A* with the first route's edges penalised), score each with the existing `recomputeTidalRoute`, and offer the fastest. This also combines with the best-departure sweep.

Prefer this over time-dependent A*: currents live in JS while routing is in WASM, the heuristic would have to assume the best possible current everywhere, the shore penalty is in metres rather than time, and station coverage (one NOAA station per stretch within 8 km) is too sparse for per-edge precision.

Limit: if both channels resolve to the same station, the model cannot tell them apart. Users can already force a channel with a middle waypoint.

## Segment budget is not a real cap

`simplifyRoute` in `src/services/tidalRoute.ts` can return almost twice `maxSegments` because it steps by `floor(length / maxSegments)`: 59 coordinates with a budget of 20 gives 29 segments.

No harmful side effects today. More segments means currents are sampled more often, and stations are fetched once each. Either honour the cap or rename the parameter.

## Bugs

### A NOAA failure silently drops currents

When `fetchTidalData` fails, the catch in `fetchTides` (`MapView.tsx:331`) logs to the console and sets the cache to null. The panel then shows a plain distance-over-speed estimate with no notice that tides and wind are missing.

### Stale numbers while tides reload

After a new waypoint or a date change, the previous `tidalCache` stays in use until the new fetch returns. Duration, arrival and distance belong to the previous route or date in the meantime. The only signal is a small "Calculating effects..." line in `RouteSection`; the collapsed mobile sheet (`TripSummary`) shows nothing.

### `formatDuration` can print "1h 60m"

`src/lib/format.ts` floors the hours and then rounds the minutes, so 1.995 h gives "1h 60m" and 0.995 h gives "60m".

### Desktop cannot remove a lone first waypoint

Undo and Clear live in `RouteSection`, which only renders when `summary.hasRoute` is true. On desktop a single waypoint (or two waypoints that snap to the same node, giving zero distance) cannot be removed. Mobile has an undo button in `TripSummary` from the first waypoint.

### The stall warning assumes current is the cause

`RouteWarnings` always says "Current stronger than your speed" and "Near {stationName}". A stall caused by wind alone on a lake names the lake, and where there is no station the text reads "Near , around 9:40".

### The distance changes when tides load

Before tides load, the panel shows the router's distance (the unsmoothed grid path, from WASM). After, `summarizeRoute` shows `tidalResult.totalDistanceNm`, the length of the smoothed line, which is shorter. If the tide fetch fails, the longer number stays.

### Predictions are refetched on every waypoint and undo

`fetchTidalData` builds a fresh predictions map on each call, so every added or removed waypoint downloads the same stations' 48 h predictions again. The station list is cached; predictions are not.

### The forecast cache never expires

`forecastCache` in `src/services/nws.ts` (and the NOAA station cache) lives for the life of the page. A home-screen app resumed days later shows the old forecast.

### Stalled stretches are drawn as straight chords

The `route-stalls` layer draws each stalled segment as a straight line between its two simplified endpoints, so the red overlay can cut across land instead of following the blue route.

### The weather panel and the timing use different wind

The weather panel and share card take the forecast at the first waypoint (or the region's centre before there is a route), for the departure hour only (`MapView.tsx:298`). The timing maths takes it at the route's midpoint (`fetchTidalData` in `src/services/tidalRoute.ts`), hour by hour as the trip progresses. On longer routes or trips the "Wind Effect" figure may not seem to follow from the wind shown.

Use the same point for both, which also saves a request. The hour-by-hour difference is correct; label the panel's wind as being at departure.

### Units are mixed

Distance is shown in statute miles (`formatDistance` in `src/lib/format.ts`), boat speed and stall warnings in knots, and wind in mph (`WeatherSection`, `FloatPlanCard`). The numbers on screen do not check against each other: 6.9 mi at 3 knots looks like 2 h 18 m but is 2 h, because 6.9 statute miles is 6 nautical miles.

Decision: use knots and nautical miles throughout. Show distance in nautical miles and wind in knots. The maths is already in nautical miles and knots; only the display changes.

## Cleanup

- `set_panic_hook` in `navigator_core/src/utils.rs` is never called, so WASM panics give no readable message.
- Unused code: the `alert` extern in `navigator_core/src/lib.rs`, `findNearestStation` in `src/services/noaa.ts`, and `EditableGraph` in `src/pages/MapView/MapView.types.ts`.
- `package.json` is still named `vite-react`.
- The README says the app covers NYC only; Seattle is now a region.
