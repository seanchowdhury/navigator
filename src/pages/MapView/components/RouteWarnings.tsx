import { ReactNode } from "react";
import { formatClock, formatDay } from "../../../lib/time";
import { RouteNote } from "../../../regions";
import { WindCoverage } from "../../../services/tidalRoute";
import { RouteSummary } from "../routeSummary";

interface RouteWarningsProps {
  summary: RouteSummary;
  /** Region notes the route passes near (e.g. locks). */
  routeNotes: RouteNote[];
  timezone: string;
  /** Suggest how to avoid a stall; off when the plan is being shared rather than edited. */
  showAdvice?: boolean;
  /** Fetches tide and wind data again; leave out where the plan can't be edited. */
  onRetryEffects?: () => void;
}

/** Something the timings leave out. */
function Notice({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-xs space-y-1"
      style={{ padding: 6 }}
    >
      <div className="font-bold">⚠ {title}</div>
      <div>{children}</div>
    </div>
  );
}

/** Why wind is missing from some or all of the trip. */
function windGapMessage(wind: Exclude<WindCoverage, { kind: "full" }>, timezone: string) {
  const all = wind.kind === "none";
  switch (wind.reason) {
    case "failed":
      return "Couldn't load the wind forecast, so these times don't account for wind.";
    case "beforeForecast":
      return all
        ? "There's no wind forecast for times already past, so these times don't account for wind."
        : "The trip starts before the wind forecast does, so wind only counts for the later part.";
    case "beyondForecast": {
      if (!wind.forecastEnd) return "The wind forecast doesn't reach this far, so these times don't account for wind.";
      return all
        ? `The wind forecast only runs to ${formatDay(wind.forecastEnd, timezone)}, so these times don't account for wind.`
        : `The wind forecast ends at ${formatClock(wind.forecastEnd, timezone)} on ${formatDay(wind.forecastEnd, timezone)}; the rest of the trip doesn't account for wind.`;
    }
  }
}

/**
 * What the timings leave out (failed or missing tide and wind data), the
 * strong-current warning and region notes, each only when it applies.
 */
export default function RouteWarnings({
  summary,
  routeNotes,
  timezone,
  showAdvice = true,
  onRetryEffects,
}: RouteWarningsProps) {
  const { stallStretches, worstFirstStall, effectsUnavailable, missingCurrentData, wind } = summary;
  const firstStall = stallStretches[0];
  const retry = onRetryEffects && (
    <>
      {" "}
      <button type="button" className="underline font-medium" onClick={onRetryEffects}>
        Retry
      </button>
    </>
  );

  return (
    <>
      {effectsUnavailable && (
        <Notice title="Tides and wind not included">
          Couldn't load tide and wind data, so these times assume still water and no wind.
          {retry}
        </Notice>
      )}

      {wind.kind !== "full" && (
        <Notice title={wind.kind === "none" ? "Wind not included" : "Wind only partly included"}>
          {windGapMessage(wind, timezone)}
          {/* Only a failed request can be retried; a date out of range can't. */}
          {wind.reason === "failed" && retry}
        </Notice>
      )}

      {missingCurrentData && (
        <Notice title="Current not included for part of the route">
          No current predictions near part of this route; those stretches assume no current.
        </Notice>
      )}

      {firstStall && worstFirstStall && (
        <div
          className="rounded-md border border-red-300 bg-red-50 text-red-800 text-xs space-y-1"
          style={{ padding: 6 }}
        >
          <div className="font-bold">⚠ Current stronger than your speed</div>
          <div>
            Near {firstStall[0].stationName}, around{" "}
            {formatClock(firstStall[0].startTime, timezone)}
            ,{" "}
            {worstFirstStall.netSpeed < 0
              ? `you'd be pushed back at ${Math.abs(worstFirstStall.netSpeed).toFixed(1)} kts`
              : `you'd make only ${worstFirstStall.netSpeed.toFixed(1)} kts`}
            .
            {stallStretches.length > 1 &&
              ` +${stallStretches.length - 1} more stretch${stallStretches.length > 2 ? "es" : ""}.`}
          </div>
          {showAdvice && <div>Try another departure time or a faster speed.</div>}
        </div>
      )}

      {routeNotes.map((note) => (
        <div
          key={note.name}
          className="rounded-md border border-amber-300 bg-amber-50 text-amber-900 text-xs space-y-1"
          style={{ padding: 6 }}
        >
          <div className="font-bold">ⓘ {note.name}</div>
          <div>{note.message}</div>
        </div>
      ))}
    </>
  );
}
