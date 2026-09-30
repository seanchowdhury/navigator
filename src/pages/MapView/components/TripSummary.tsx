import { formatClock } from "../../../lib/time";
import { formatDistance, formatDuration } from "../../../lib/format";
import { RouteSummary } from "../routeSummary";

interface TripSummaryProps {
  summary: RouteSummary;
  roundTrip: boolean;
  timezone: string;
}

/** One-line trip totals for the collapsed bottom sheet. */
export default function TripSummary({ summary, roundTrip, timezone }: TripSummaryProps) {
  if (!summary.hasRoute) {
    return <p className="text-sm text-muted-foreground">Tap the water to start a route.</p>;
  }

  const prefix = summary.isLowerBound ? "≥ " : "";
  return (
    <div className="flex items-center gap-2 text-sm">
      {summary.isLowerBound && (
        <span className="text-red-600" title="Current stronger than your speed">
          ⚠
        </span>
      )}
      <span className="font-medium">{formatDistance(summary.displayDistance)}</span>
      <span className="text-muted-foreground">·</span>
      <span className="font-medium">
        {prefix}
        {formatDuration(summary.durationHours)}
      </span>
      <span className="text-muted-foreground">·</span>
      <span>
        <span className="text-muted-foreground">{roundTrip ? "Back " : "Arrive "}</span>
        <span className="font-medium">
          {prefix}
          {formatClock(summary.arrival, timezone)}
        </span>
      </span>
    </div>
  );
}
