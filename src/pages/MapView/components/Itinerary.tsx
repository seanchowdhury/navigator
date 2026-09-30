import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { ItineraryStop } from "../../../services/tidalRoute";
import { Waypoint } from "../MapView.types";
import { formatClock } from "../../../lib/time";

interface Row {
  key: string;
  waypoint: Waypoint;
  waypointIndex: number;
  direction: "out" | "back";
  label: string;
  /** Whether this row takes a stop time (not the start or the finish). */
  canStop: boolean;
}

/** Every arrival in trip order: out to the last waypoint, then back to the start. */
function buildRows(waypoints: Waypoint[], roundTrip: boolean): Row[] {
  const last = waypoints.length - 1;
  const rows: Row[] = [];
  for (let i = 1; i <= last; i++) {
    const isEnd = i === last;
    rows.push({
      key: `out-${waypoints[i].id}`,
      waypoint: waypoints[i],
      waypointIndex: i,
      direction: "out",
      label: isEnd ? (roundTrip ? "Turnaround" : "Finish") : `Waypoint ${i + 1}`,
      canStop: !isEnd || roundTrip,
    });
  }
  if (roundTrip) {
    for (let i = last - 1; i >= 0; i--) {
      rows.push({
        key: `back-${waypoints[i].id}`,
        waypoint: waypoints[i],
        waypointIndex: i,
        direction: "back",
        label: i === 0 ? "Back at start" : `Waypoint ${i + 1} (back)`,
        canStop: i > 0,
      });
    }
  }
  return rows;
}

interface ItineraryProps {
  waypoints: Waypoint[];
  roundTrip: boolean;
  departureTime: Date;
  /** Region's IANA zone; times are shown in it. */
  timezone: string;
  /** Null while tides are loading or unavailable; stops stay editable. */
  stops: ItineraryStop[] | null;
  onStopChange: (waypointId: string, direction: "out" | "back", minutes: number) => void;
}

export default function Itinerary({
  waypoints,
  roundTrip,
  departureTime,
  timezone,
  stops,
  onStopChange,
}: ItineraryProps) {
  if (waypoints.length < 2) return null;
  const rows = buildRows(waypoints, roundTrip);
  const find = (row: Row) =>
    stops?.find((s) => s.waypointIndex === row.waypointIndex && s.direction === row.direction);

  return (
    <div className="space-y-1">
      <div className="font-bold text-xs uppercase tracking-wide text-foreground">Itinerary</div>
      <ol className="text-xs space-y-1">
        <li className="flex justify-between items-center gap-2 min-h-7">
          <span>
            <Badge label={waypoints[0].label} /> Start
          </span>
          <span className="font-medium">Leave {formatClock(departureTime, timezone)}</span>
        </li>
        {rows.map((row) => {
          const stop = find(row);
          const minutes = row.direction === "out" ? row.waypoint.stopMinutes : row.waypoint.returnStopMinutes;
          const prefix = stop?.lowerBound ? "≥ " : "";
          return (
            <li key={row.key} className="flex justify-between items-center gap-2 min-h-7">
              <span className="truncate">
                <Badge label={row.waypoint.label} /> {row.label}
              </span>
              <span className="flex items-center gap-1 shrink-0">
                <span className="font-medium">{stop ? `${prefix}${formatClock(stop.arrival, timezone)}` : "—"}</span>
                {row.canStop && (
                  <>
                    <span className="text-muted-foreground">· stop</span>
                    <StopInput
                      minutes={minutes}
                      onCommit={(value) => onStopChange(row.waypoint.id, row.direction, value)}
                      label={`Stop minutes at ${row.label}`}
                    />
                    <span className="text-muted-foreground">min</span>
                  </>
                )}
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-blue-600 text-white text-[10px] font-bold align-middle">
      {label}
    </span>
  );
}

const COMMIT_DELAY_MS = 400;

/**
 * Minutes input that keeps its own draft while typing and commits after a pause,
 * on blur, or on Enter — so each keystroke doesn't recompute the whole trip, and
 * clearing the box mid-edit doesn't snap it back to 0.
 */
function StopInput({ minutes, onCommit, label }: { minutes: number; onCommit: (minutes: number) => void; label: string }) {
  const [draft, setDraft] = useState(String(minutes));
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Follow outside changes (e.g. the route being cleared) when not mid-edit.
  useEffect(() => {
    if (!timerRef.current) setDraft(String(minutes));
  }, [minutes]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  function commit(text: string) {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const value = Math.max(0, Math.round(Number(text) || 0));
    setDraft(String(value));
    if (value !== minutes) onCommit(value);
  }

  return (
    <Input
      type="number"
      min={0}
      step={5}
      value={draft}
      onChange={(e) => {
        const text = e.target.value;
        setDraft(text);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => commit(text), COMMIT_DELAY_MS);
      }}
      onBlur={(e) => commit(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit(e.currentTarget.value);
      }}
      className="w-14 h-6 text-base md:text-xs text-right px-1"
      aria-label={label}
    />
  );
}
