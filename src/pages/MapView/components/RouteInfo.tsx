import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  DepartureSweep,
  TidalRouteResult,
  TidalSegment,
  VesselType,
  VESSEL_LABELS,
} from "../../../services/tidalRoute";
import { WindForecast } from "../../../services/nws";
import { ArrowUp, Clock } from "lucide-react";
import BestDeparture from "./BestDeparture";
import Itinerary from "./Itinerary";
import { Waypoint } from "../MapView.types";

function formatDistance(meters: number) {
  const miles = meters / 1609.344;
  return `${miles.toFixed(2)} mi`;
}

function getTravelHours(meters: number, knots: number) {
  return meters / 1852 / knots;
}

function formatDuration(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

function getEndTime(startTime: string, travelHours: number) {
  const [hours, minutes] = startTime.split(":").map(Number);
  const startDate = new Date();
  startDate.setHours(hours, minutes, 0, 0);
  const endDate = new Date(startDate.getTime() + travelHours * 60 * 60 * 1000);
  return endDate.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
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

function degreesToCompass(deg: number): string {
  const dirs = [
    "N",
    "NNE",
    "NE",
    "ENE",
    "E",
    "ESE",
    "SE",
    "SSE",
    "S",
    "SSW",
    "SW",
    "WSW",
    "W",
    "WNW",
    "NW",
    "NNW",
  ];
  return dirs[Math.round(deg / 22.5) % 16];
}

interface RouteInfoProps {
  totalDistance: number;
  onClear: () => void;
  tidalResult: TidalRouteResult | null;
  tidalLoading: boolean;
  speedKnots: number;
  onSpeedChange: (speed: number) => void;
  departureTime: string;
  onDepartureTimeChange: (time: string) => void;
  departureDate: string;
  onDepartureDateChange: (date: string) => void;
  vesselType: VesselType;
  onVesselTypeChange: (vessel: VesselType) => void;
  weather: WindForecast | null;
  onSweepDepartures: (windowStart: string, windowEnd: string) => DepartureSweep | null;
  roundTrip: boolean;
  onRoundTripChange: (roundTrip: boolean) => void;
  waypoints: Waypoint[];
  onStopChange: (waypointId: string, direction: "out" | "back", minutes: number) => void;
}

export default function RouteInfo({
  totalDistance,
  onClear,
  tidalResult,
  tidalLoading,
  speedKnots,
  onSpeedChange,
  departureTime,
  onDepartureTimeChange,
  departureDate,
  onDepartureDateChange,
  vesselType,
  onVesselTypeChange,
  weather,
  onSweepDepartures,
  roundTrip,
  onRoundTripChange,
  waypoints,
  onStopChange,
}: RouteInfoProps) {
  const [showBestDeparture, setShowBestDeparture] = useState(false);
  // Once tides are computed, show the same route length the timings are based on.
  // totalDistance is the drawn (outbound) route; a round trip covers it twice.
  const tripDistance = roundTrip ? totalDistance * 2 : totalDistance;
  const displayDistance = tidalResult ? tidalResult.totalDistanceNm * 1852 : tripDistance;
  const fallbackStopHours = totalStopMinutes(waypoints, roundTrip) / 60;
  const baseTravelHours = getTravelHours(tripDistance, speedKnots) + fallbackStopHours;
  const stopHours = tidalResult ? tidalResult.stopHours : fallbackStopHours;
  const adjustedHours = tidalResult?.totalDurationHours ?? baseTravelHours;
  const tideDelta = tidalResult?.tideDeltaMinutes ?? 0;
  const windDelta = tidalResult?.windDeltaMinutes ?? 0;
  const hasRoute = totalDistance > 0;
  const stallStretches =
    tidalResult && !tidalLoading ? getStallStretches(tidalResult.segments) : [];
  const firstStall = stallStretches[0];
  const worstFirstStall = firstStall?.reduce((a, b) => (b.netSpeed < a.netSpeed ? b : a));
  // When the boat can't make headway, durations are a lower bound, not an estimate.
  const durationPrefix = stallStretches.length > 0 ? "≥ " : "";

  return (
    <Card
      className="absolute top-4 left-4 z-10 w-84 max-h-[calc(100dvh-2rem)] overflow-auto overscroll-contain"
      style={{ padding: 10 }}
    >
      <CardHeader className="pb-2">
        <CardTitle>Float Plan</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="text-sm">
          {/* --- Departure Inputs --- */}
          <div
            className="rounded-md border border-border bg-muted/30 space-y-3"
            style={{ padding: "6px", margin: "6px" }}
          >
            <div className="font-bold text-sm uppercase tracking-wide text-foreground mb-2">
              Departure
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Date</span>
              <Input
                type="date"
                value={departureDate}
                onChange={(e) => onDepartureDateChange(e.target.value)}
                className="w-36 text-right"
              />
            </div>
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Time</span>
              <Input
                type="time"
                value={departureTime}
                onChange={(e) => onDepartureTimeChange(e.target.value)}
                className="w-28 text-right"
              />
            </div>
            <Button
              size="sm"
              variant={showBestDeparture ? "default" : "outline"}
              className="w-full"
              disabled={!hasRoute}
              title={hasRoute ? undefined : "Add a route first"}
              onClick={() => setShowBestDeparture((open) => !open)}
            >
              <Clock size={14} />
              {showBestDeparture ? "Hide best time" : "Find best time"}
            </Button>
            {showBestDeparture && hasRoute && (
              <BestDeparture
                onSweep={onSweepDepartures}
                onUseTime={onDepartureTimeChange}
                departureTime={departureTime}
              />
            )}
            <div className="flex justify-between items-center">
              <span className="text-muted-foreground">Vessel</span>
              <select
                value={vesselType}
                onChange={(e) =>
                  onVesselTypeChange(e.target.value as VesselType)
                }
                className="border rounded px-2 py-1 text-sm bg-background"
              >
                {Object.entries(VESSEL_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Speed</span>
                <span className="font-medium">{speedKnots} knots</span>
              </div>
              <Slider
                min={1}
                max={6}
                step={0.5}
                value={[speedKnots]}
                onValueChange={([v]) => onSpeedChange(v)}
              />
            </div>
          </div>

          {/* --- Weather --- */}
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3 mt-4" style={{ padding: "6px", margin: "6px" }}>
            <div className="font-bold text-sm uppercase tracking-wide text-foreground mb-2">
              Weather
            </div>
            {weather ? (
              <>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Forecast</span>
                  <span className="font-medium">{weather.shortForecast}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Temperature</span>
                  <span className="font-medium">{weather.temperatureF}°F</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-muted-foreground">Wind</span>
                  <span className="font-medium flex items-center gap-1">
                    {(weather.speedKnots / 0.868976).toFixed(0)} mph{" "}
                    {weather.windDirectionLabel ||
                      degreesToCompass(weather.directionDeg)}
                    <ArrowUp
                      size={14}
                      className="inline-block"
                      style={{
                        transform: `rotate(${weather.directionDeg + 180}deg)`,
                      }}
                    />
                  </span>
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground italic">
                Loading weather...
              </div>
            )}
          </div>

          {/* --- Route Info --- */}
          {hasRoute && (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-3 mt-4" style={{ padding: "6px", margin: "6px" }}>
              <div className="font-bold text-sm uppercase tracking-wide text-foreground mb-2">
                Route
              </div>
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
                <span className="font-medium">
                  {formatDistance(displayDistance)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-medium">
                  {durationPrefix}
                  {formatDuration(adjustedHours)}
                  {stopHours > 0 && (
                    <span className="text-muted-foreground font-normal"> incl. {formatDuration(stopHours)} stopped</span>
                  )}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">{roundTrip ? "Est. Return" : "Est. Arrival"}</span>
                <span className="font-medium">
                  {durationPrefix}
                  {getEndTime(departureTime, adjustedHours)}
                </span>
              </div>

              <Itinerary
                waypoints={waypoints}
                roundTrip={roundTrip}
                departureTime={new Date(`${departureDate}T${departureTime}`)}
                stops={tidalResult && !tidalLoading ? tidalResult.itinerary : null}
                onStopChange={onStopChange}
              />

              {tidalLoading && (
                <div className="text-xs text-muted-foreground italic">
                  Calculating effects...
                </div>
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
                    {firstStall[0].startTime.toLocaleTimeString([], {
                      hour: "numeric",
                      minute: "2-digit",
                    })}
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

              <Button
                variant="destructive"
                size="sm"
                className="w-full mt-2"
                onClick={onClear}
              >
                Clear Route
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
