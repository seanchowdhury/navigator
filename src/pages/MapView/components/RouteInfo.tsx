import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { TidalRouteResult } from "../../../services/tidalRoute";

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
  return endDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
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
}: RouteInfoProps) {
  const baseTravelHours = getTravelHours(totalDistance, speedKnots);
  const adjustedHours = tidalResult?.totalDurationHours ?? baseTravelHours;
  const tideDelta = tidalResult?.tideDeltaMinutes ?? 0;

  if (totalDistance <= 0) return null;

  return (
    <Card className="absolute top-4 left-4 z-10 w-84" style={{ padding: 10 }}>
      <CardHeader className="pb-2">
        <CardTitle>Route Info</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3 text-sm">
          <div className="flex justify-between">
            <span className="text-muted-foreground">Distance</span>
            <span className="font-medium">{formatDistance(totalDistance)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Duration</span>
            <span className="font-medium">
              {formatDuration(adjustedHours)}
            </span>
          </div>

          {tidalLoading && (
            <div className="text-xs text-muted-foreground italic">
              Loading tidal data...
            </div>
          )}

          {tidalResult && !tidalLoading && (
            <div className="flex justify-between">
              <span className="text-muted-foreground">Tide Effect</span>
              <span
                className={`font-medium ${tideDelta < 0 ? "text-green-600" : tideDelta > 0 ? "text-red-500" : ""}`}
              >
                {tideDelta > 0 ? "+" : ""}
                {Math.round(tideDelta)}m
              </span>
            </div>
          )}

          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Departure Date</span>
            <Input
              type="date"
              value={departureDate}
              onChange={(e) => onDepartureDateChange(e.target.value)}
              className="w-36 text-right"
            />
          </div>
          <div className="flex justify-between items-center">
            <span className="text-muted-foreground">Departure Time</span>
            <Input
              type="time"
              value={departureTime}
              onChange={(e) => onDepartureTimeChange(e.target.value)}
              className="w-28 text-right"
            />
          </div>
          <div className="flex justify-between">
            <span className="text-muted-foreground">Est. Arrival</span>
            <span className="font-medium">
              {getEndTime(departureTime, adjustedHours)}
            </span>
          </div>
          <div className="space-y-1">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Avg. Speed</span>
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
        <Button
          variant="destructive"
          size="sm"
          className="w-full"
          onClick={onClear}
        >
          Clear Route
        </Button>
      </CardContent>
    </Card>
  );
}
