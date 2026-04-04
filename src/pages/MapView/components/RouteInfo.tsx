import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  TidalRouteResult,
  VesselType,
  VESSEL_LABELS,
} from "../../../services/tidalRoute";
import { WindForecast } from "../../../services/nws";
import { ArrowUp } from "lucide-react";

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
}: RouteInfoProps) {
  const baseTravelHours = getTravelHours(totalDistance, speedKnots);
  const adjustedHours = tidalResult?.totalDurationHours ?? baseTravelHours;
  const tideDelta = tidalResult?.tideDeltaMinutes ?? 0;
  const windDelta = tidalResult?.windDeltaMinutes ?? 0;
  const hasRoute = totalDistance > 0;

  return (
    <Card className="absolute top-4 left-4 z-10 w-84" style={{ padding: 10 }}>
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
                min={2}
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
              <div className="flex justify-between">
                <span className="text-muted-foreground">Distance</span>
                <span className="font-medium">
                  {formatDistance(totalDistance)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Duration</span>
                <span className="font-medium">
                  {formatDuration(adjustedHours)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Est. Arrival</span>
                <span className="font-medium">
                  {getEndTime(departureTime, adjustedHours)}
                </span>
              </div>

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
