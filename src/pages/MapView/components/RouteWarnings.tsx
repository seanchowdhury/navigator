import { formatClock } from "../../../lib/time";
import { RouteNote } from "../../../regions";
import { RouteSummary } from "../routeSummary";

interface RouteWarningsProps {
  summary: RouteSummary;
  /** Region notes the route passes near (e.g. locks). */
  routeNotes: RouteNote[];
  timezone: string;
  /** Suggest how to avoid a stall; off when the plan is being shared rather than edited. */
  showAdvice?: boolean;
}

/** The strong-current warning and region notes, each only when it applies. */
export default function RouteWarnings({
  summary,
  routeNotes,
  timezone,
  showAdvice = true,
}: RouteWarningsProps) {
  const { stallStretches, worstFirstStall } = summary;
  const firstStall = stallStretches[0];

  return (
    <>
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
