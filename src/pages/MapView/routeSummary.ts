import { TidalRouteResult, TidalSegment } from "../../services/tidalRoute";
import { Waypoint } from "./MapView.types";

function getTravelHours(meters: number, knots: number) {
  return meters / 1852 / knots;
}

/** Groups consecutive stalled segments into stretches of the route. */
function getStallStretches(segments: TidalSegment[]): TidalSegment[][] {
  const stretches: TidalSegment[][] = [];
  let current: TidalSegment[] = [];

  for (const segment of segments) {
    if (segment.stalled) {
      current.push(segment);
    } else if (current.length > 0) {
      stretches.push(current);
      current = [];
    }
  }
  if (current.length > 0) stretches.push(current);

  return stretches;
}

/** Stop minutes that apply to the trip (mirrors the stop rules in recomputeTidalRoute). */
function totalStopMinutes(waypoints: Waypoint[], roundTrip: boolean) {
  const last = waypoints.length - 1;
  return waypoints.reduce((sum, w, i) => {
    if (i === 0) return sum;
    const out = i < last || roundTrip ? w.stopMinutes : 0;
    const back = roundTrip && i < last ? w.returnStopMinutes : 0;
    return sum + out + back;
  }, 0);
}

export interface RouteSummaryInput {
  /** The drawn (outbound) route in meters. */
  totalDistance: number;
  tidalResult: TidalRouteResult | null;
  tidalLoading: boolean;
  speedKnots: number;
  roundTrip: boolean;
  waypoints: Waypoint[];
  departure: Date;
}

export interface RouteSummary {
  hasRoute: boolean;
  /** Meters, matching the distance the timings are based on. */
  displayDistance: number;
  durationHours: number;
  stopHours: number;
  arrival: Date;
  tideDeltaMinutes: number;
  windDeltaMinutes: number;
  /** Runs of legs where the current beats the boat's speed. */
  stallStretches: TidalSegment[][];
  /** The slowest leg of the first stall stretch. */
  worstFirstStall: TidalSegment | undefined;
  /** When the boat can't make headway, durations are a lower bound, not an estimate. */
  isLowerBound: boolean;
}

/** Derives the trip totals shown in the float plan from the route and tidal result. */
export function summarizeRoute({
  totalDistance,
  tidalResult,
  tidalLoading,
  speedKnots,
  roundTrip,
  waypoints,
  departure,
}: RouteSummaryInput): RouteSummary {
  // Once tides are computed, show the same route length the timings are based on.
  // totalDistance is the drawn (outbound) route; a round trip covers it twice.
  const tripDistance = roundTrip ? totalDistance * 2 : totalDistance;
  const fallbackStopHours = totalStopMinutes(waypoints, roundTrip) / 60;
  const durationHours =
    tidalResult?.totalDurationHours ??
    getTravelHours(tripDistance, speedKnots) + fallbackStopHours;
  const stallStretches =
    tidalResult && !tidalLoading ? getStallStretches(tidalResult.segments) : [];

  return {
    hasRoute: totalDistance > 0,
    displayDistance: tidalResult ? tidalResult.totalDistanceNm * 1852 : tripDistance,
    durationHours,
    stopHours: tidalResult ? tidalResult.stopHours : fallbackStopHours,
    arrival: new Date(departure.getTime() + durationHours * 60 * 60 * 1000),
    tideDeltaMinutes: tidalResult?.tideDeltaMinutes ?? 0,
    windDeltaMinutes: tidalResult?.windDeltaMinutes ?? 0,
    stallStretches,
    worstFirstStall: stallStretches[0]?.reduce((a, b) => (b.netSpeed < a.netSpeed ? b : a)),
    isLowerBound: stallStretches.length > 0,
  };
}
