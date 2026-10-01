import { Share, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TidalRouteResult } from "../../../services/tidalRoute";
import { formatClock } from "../../../lib/time";
import { formatDistance, formatDuration } from "../../../lib/format";
import { RouteNote } from "../../../regions";
import { Waypoint } from "../MapView.types";
import { RouteSummary } from "../routeSummary";
import Itinerary from "./Itinerary";
import RouteWarnings from "./RouteWarnings";
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
  onUndo: () => void;
  onShare: () => void;
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
  onUndo,
  onShare,
}: RouteSectionProps) {
  const {
    displayDistance,
    durationHours,
    stopHours,
    arrival,
    tideDeltaMinutes: tideDelta,
    windDeltaMinutes: windDelta,
    isLowerBound,
  } = summary;
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

      <RouteWarnings summary={summary} routeNotes={routeNotes} timezone={timezone} />

      <Button size="sm" className="mt-2 w-full" onClick={onShare}>
        <Share />
        Share float plan
      </Button>
      <div className="flex gap-2">
        <Button variant="outline" size="sm" className="flex-1" onClick={onUndo}>
          <Undo2 />
          Undo last waypoint
        </Button>
        <Button variant="destructive" size="sm" className="flex-1" onClick={onClear}>
          Clear Route
        </Button>
      </div>
    </Section>
  );
}
