import { Button } from "@/components/ui/button";
import { TidalRouteResult } from "../../../services/tidalRoute";
import { formatClock } from "../../../lib/time";
import { formatDistance, formatDuration } from "../../../lib/format";
import { RouteNote } from "../../../regions";
import { Waypoint } from "../MapView.types";
import { RouteSummary } from "../routeSummary";
import Itinerary from "./Itinerary";
import Section from "./Section";

interface RouteSectionProps {
  summary: RouteSummary;
  tidalResult: TidalRouteResult | null;
  tidalLoading: boolean;
  roundTrip: boolean;
  onRoundTripChange: (roundTrip: boolean) => void;
  waypoints: Waypoint[];
  onStopChange: (waypointId: string, direction: "out" | "back", minutes: number) => void;
  departure: Date;
  timezone: string;
  /** Region notes the route passes near (e.g. locks). */
  routeNotes: RouteNote[];
  onClear: () => void;
}

export default function RouteSection({
  summary,
  tidalResult,
  tidalLoading,
  roundTrip,
  onRoundTripChange,
  waypoints,
  onStopChange,
  departure,
  timezone,
  routeNotes,
  onClear,
}: RouteSectionProps) {
  const {
    displayDistance,
    durationHours,
    stopHours,
    arrival,
    tideDeltaMinutes: tideDelta,
    windDeltaMinutes: windDelta,
    stallStretches,
    worstFirstStall,
    isLowerBound,
  } = summary;
  const firstStall = stallStretches[0];
  const durationPrefix = isLowerBound ? "≥ " : "";

  return (
    <Section title="Route">
      <label className="flex justify-between items-center cursor-pointer">
        <span className="text-muted-foreground">Round trip</span>
        <input
          type="checkbox"
          checked={roundTrip}
          onChange={(e) => onRoundTripChange(e.target.checked)}
          className="h-4 w-4 accent-blue-600 cursor-pointer"
        />
      </label>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Distance</span>
        <span className="font-medium">{formatDistance(displayDistance)}</span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">Duration</span>
        <span className="font-medium">
          {durationPrefix}
          {formatDuration(durationHours)}
          {stopHours > 0 && (
            <span className="text-muted-foreground font-normal"> incl. {formatDuration(stopHours)} stopped</span>
          )}
        </span>
      </div>
      <div className="flex justify-between">
        <span className="text-muted-foreground">{roundTrip ? "Est. Return" : "Est. Arrival"}</span>
        <span className="font-medium">
          {durationPrefix}
          {formatClock(arrival, timezone)}
        </span>
      </div>

      <Itinerary
        waypoints={waypoints}
        roundTrip={roundTrip}
        departureTime={departure}
        timezone={timezone}
        stops={tidalResult && !tidalLoading ? tidalResult.itinerary : null}
        onStopChange={onStopChange}
      />

      {tidalLoading && (
        <div className="text-xs text-muted-foreground italic">Calculating effects...</div>
      )}

      {tidalResult && !tidalLoading && (
        <>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Tide Effect</span>
            <span
              className={`font-medium ${tideDelta < 0 ? "text-green-600" : tideDelta > 0 ? "text-red-500" : ""}`}
            >
              {tideDelta > 0 ? "+" : ""}
              {Math.round(tideDelta)}m
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Wind Effect</span>
            <span
              className={`font-medium ${windDelta < 0 ? "text-green-600" : windDelta > 0 ? "text-red-500" : ""}`}
            >
              {windDelta > 0 ? "+" : ""}
              {Math.round(windDelta)}m
            </span>
          </div>
          {tidalResult.missingCurrentData && (
            <p className="text-xs text-muted-foreground">
              No current predictions near part of this route; those stretches assume no current.
            </p>
          )}
        </>
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
          <div>Try another departure time or a faster speed.</div>
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

      <Button variant="destructive" size="sm" className="w-full mt-2" onClick={onClear}>
        Clear Route
      </Button>
    </Section>
  );
}
