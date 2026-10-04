import { Share, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatClock } from "../../../lib/time";
import { formatDistance, formatDuration } from "../../../lib/format";
import { RouteSummary } from "../routeSummary";

interface TripSummaryProps {
  summary: RouteSummary;
  roundTrip: boolean;
  departure: Date;
  timezone: string;
  waypointCount: number;
  onUndo: () => void;
  onShare: () => void;
}

/** Departure, arrival and trip totals for the collapsed bottom sheet. */
export default function TripSummary({
  summary,
  roundTrip,
  departure,
  timezone,
  waypointCount,
  onUndo,
  onShare,
}: TripSummaryProps) {
  const prefix = summary.isLowerBound ? "≥ " : "";

  return (
    <div className="flex items-center gap-3">
      {summary.hasRoute ? (
        <Button variant="outline" size="icon" onClick={onShare} aria-label="Share float plan">
          <Share />
        </Button>
      ) : (
        // Balances the undo button so the text stays centered.
        <div className="size-8 shrink-0" aria-hidden="true" />
      )}
      <div className="min-w-0 flex-1 text-center text-sm">
        <div>
          {summary.isLowerBound && (
            <span className="mr-1 text-red-600" title="Current stronger than your speed">
              ⚠
            </span>
          )}
          {(summary.effectsUnavailable || summary.wind.kind !== "full") && (
            <span
              className="mr-1 text-amber-600"
              title={summary.effectsUnavailable ? "Tides and wind not included" : "Wind not fully included"}
            >
              ⚠
            </span>
          )}
          <span className="text-muted-foreground">Leave </span>
          <span className="font-medium">{formatClock(departure, timezone)}</span>
          {summary.hasRoute && (
            <>
              <span className="text-muted-foreground"> → {roundTrip ? "Back " : "Arrive "}</span>
              <span className="font-medium">
                {prefix}
                {formatClock(summary.arrival, timezone)}
              </span>
            </>
          )}
        </div>
        <div className="text-muted-foreground">
          {summary.hasRoute
            ? `${formatDistance(summary.displayDistance)} · ${prefix}${formatDuration(summary.durationHours)}${
                summary.effectsLoading ? " · calculating…" : ""
              }`
            : waypointCount === 0
              ? "Tap the water to start a route."
              : "Tap the water to add the next waypoint."}
        </div>
      </div>
      {waypointCount > 0 ? (
        <Button variant="outline" size="icon" onClick={onUndo} aria-label="Undo last waypoint">
          <Undo2 />
        </Button>
      ) : (
        <div className="size-8 shrink-0" aria-hidden="true" />
      )}
    </div>
  );
}
