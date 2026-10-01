import { Waypoint } from "./MapView.types";

export interface Row {
  key: string;
  waypoint: Waypoint;
  waypointIndex: number;
  direction: "out" | "back";
  label: string;
  /** Whether this row takes a stop time (not the start or the finish). */
  canStop: boolean;
}

/** Every arrival in trip order: out to the last waypoint, then back to the start. */
export function buildRows(waypoints: Waypoint[], roundTrip: boolean): Row[] {
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
