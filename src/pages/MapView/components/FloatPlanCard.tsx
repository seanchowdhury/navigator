import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Share } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TidalRouteResult } from "../../../services/tidalRoute";
import { WindForecast, weatherEmoji } from "../../../services/nws";
import { formatClock, formatDay } from "../../../lib/time";
import { canShareFile, EXCLUDE_FROM_IMAGE, shareFile } from "../../../lib/shareImage";
import { degreesToCompass, formatDistance, formatDuration } from "../../../lib/format";
import { RouteNote } from "../../../regions";
import { Waypoint } from "../MapView.types";
import { buildRows } from "../itineraryRows";
import { RouteSummary } from "../routeSummary";
import RouteWarnings from "./RouteWarnings";

interface FloatPlanCardProps {
  summary: RouteSummary;
  tidalResult: TidalRouteResult | null;
  tidalLoading: boolean;
  waypoints: Waypoint[];
  roundTrip: boolean;
  departure: Date;
  timezone: string;
  weather: WindForecast | null;
  routeNotes: RouteNote[];
  onDone: () => void;
  /** The plan as a PNG, once it's been captured. */
  image: File | null;
  /** Capturing failed; fall back to asking for a screenshot. */
  imageFailed: boolean;
  /** Reports the card's height so the map can fit the route above it. */
  onHeightChange: (height: number) => void;
}

/** How long the screenshot hint shows before fading, so it isn't in the screenshot. */
const HINT_MS = 3500;

/** Tells people to screenshot the plan, then gets out of the way. */
function ScreenshotHint() {
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const timer = setTimeout(() => setVisible(false), HINT_MS);
    return () => clearTimeout(timer);
  }, []);

  return (
    <button
      type="button"
      role="status"
      onClick={() => setVisible(false)}
      className={`fixed left-1/2 z-20 -translate-x-1/2 rounded-full bg-foreground px-4 py-2 text-sm font-medium whitespace-nowrap text-background shadow-lg transition-opacity duration-500 ${
        visible ? "opacity-100" : "pointer-events-none opacity-0"
      }`}
      style={{ top: "calc(1rem + env(safe-area-inset-top, 0px))" }}
    >
      📸 Take a screenshot to share your plan
    </button>
  );
}

function formatMinutesDelta(minutes: number) {
  const rounded = Math.round(minutes);
  return `${rounded > 0 ? "+" : rounded < 0 ? "−" : ""}${Math.abs(rounded)} min`;
}

/** The float plan laid out to fit one phone screen, shared as an image of the screen. */
export default function FloatPlanCard({
  summary,
  tidalResult,
  tidalLoading,
  waypoints,
  roundTrip,
  departure,
  timezone,
  weather,
  routeNotes,
  onDone,
  image,
  imageFailed,
  onHeightChange,
}: FloatPlanCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(() => onHeightChange(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, [onHeightChange]);

  const prefix = summary.isLowerBound ? "≥ " : "";
  const itinerary = tidalResult && !tidalLoading ? tidalResult.itinerary : null;
  // Only places the crew will actually be stopped, not every waypoint passed.
  const stops = buildRows(waypoints, roundTrip)
    .map((row) => ({
      row,
      minutes: row.direction === "out" ? row.waypoint.stopMinutes : row.waypoint.returnStopMinutes,
      arrival: itinerary?.find(
        (s) => s.waypointIndex === row.waypointIndex && s.direction === row.direction,
      ),
    }))
    .filter(({ row, minutes }) => row.canStop && minutes > 0);

  return (
    <>
      {imageFailed && <ScreenshotHint />}
      <div
        ref={ref}
        className="fixed inset-x-0 bottom-0 z-10 flex flex-col gap-3 rounded-t-2xl border-t border-border bg-background px-5 pt-4 text-foreground shadow-[0_-4px_16px_rgba(0,0,0,0.12)] md:inset-x-auto md:bottom-4 md:left-1/2 md:w-md md:-translate-x-1/2 md:rounded-2xl md:border"
        style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            Float Plan · {formatDay(departure, timezone)}
          </div>
          <div className="flex items-center gap-1" {...{ [EXCLUDE_FROM_IMAGE]: "" }}>
            {!imageFailed && (
              <Button
                size="sm"
                disabled={!image}
                onClick={() => image && shareFile(image, "Float plan")}
              >
                <Share />
                {!image ? "Preparing…" : canShareFile(image) ? "Share" : "Save image"}
              </Button>
            )}
            <Button variant="ghost" size="sm" onClick={onDone}>
              Done
            </Button>
          </div>
        </div>

        <div className="flex flex-col gap-1">
          <div className="flex gap-8">
            <div>
              <div className="text-xs text-muted-foreground">Leave</div>
              <div className="text-2xl font-semibold">{formatClock(departure, timezone)}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{roundTrip ? "Back" : "Arrive"}</div>
              <div className="text-2xl font-semibold">
                {prefix}
                {formatClock(summary.arrival, timezone)}
              </div>
            </div>
          </div>
          <div className="text-sm text-muted-foreground">
            {formatDistance(summary.displayDistance)} · {prefix}
            {formatDuration(summary.durationHours)}
            {summary.stopHours > 0 && ` incl. ${formatDuration(summary.stopHours)} stopped`}
          </div>
        </div>

        {stops.length > 0 && (
          <ol className="flex flex-col gap-1 text-sm">
            {stops.map(({ row, minutes, arrival }) => (
              <li key={row.key} className="flex items-center justify-between gap-2">
                <span className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-blue-600 text-[11px] font-bold text-white">
                    {row.waypoint.label}
                  </span>
                  <span className="truncate">{row.label}</span>
                </span>
                <span className="shrink-0">
                  {arrival && (
                    <span className="font-medium">
                      {arrival.lowerBound ? "≥ " : ""}
                      {formatClock(arrival.arrival, timezone)}
                    </span>
                  )}
                  <span className="text-muted-foreground">
                    {arrival ? " · " : ""}
                    {minutes} min stop
                  </span>
                </span>
              </li>
            ))}
          </ol>
        )}

        {(weather || tidalResult) && (
          <div className="flex flex-col gap-0.5 text-sm">
            {weather && (
              <div>
                {weatherEmoji(weather.shortForecast, weather.isDaytime) && (
                  <span aria-hidden="true" className="mr-1.5">
                    {weatherEmoji(weather.shortForecast, weather.isDaytime)}
                  </span>
                )}
                {weather.shortForecast} · {weather.temperatureF}°F · Wind{" "}
                {(weather.speedKnots / 0.868976).toFixed(0)} mph{" "}
                {weather.windDirectionLabel || degreesToCompass(weather.directionDeg)}
              </div>
            )}
            {tidalResult && !tidalLoading && (
              <div className="text-muted-foreground">
                Current {formatMinutesDelta(tidalResult.tideDeltaMinutes)} · Wind{" "}
                {formatMinutesDelta(tidalResult.windDeltaMinutes)} on the trip
              </div>
            )}
          </div>
        )}

        <RouteWarnings summary={summary} routeNotes={routeNotes} timezone={timezone} showAdvice={false} />

        <div className="text-center text-xs text-muted-foreground">Planned with goodtid.ing</div>
      </div>
    </>
  );
}
