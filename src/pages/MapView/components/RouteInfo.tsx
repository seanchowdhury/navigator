import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DepartureSweep, TidalRouteResult, VesselType } from "../../../services/tidalRoute";
import { WindForecast } from "../../../services/nws";
import { Waypoint } from "../MapView.types";
import { summarizeRoute } from "../routeSummary";
import { Region, RouteNote } from "../../../regions";
import PlanSection from "./PlanSection";
import WeatherSection from "./WeatherSection";
import RouteSection from "./RouteSection";

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
  /** departureDate + departureTime as an instant in the region's time zone. */
  departure: Date;
  /** Region's IANA zone; all times are shown in it. */
  timezone: string;
  regions: Region[];
  selectedRegionId: string;
  onRegionSelect: (regionId: string) => void;
  /** Region notes the route passes near (e.g. locks). */
  routeNotes: RouteNote[];
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
  departure,
  timezone,
  regions,
  selectedRegionId,
  onRegionSelect,
  routeNotes,
}: RouteInfoProps) {
  const summary = summarizeRoute({
    totalDistance,
    tidalResult,
    tidalLoading,
    speedKnots,
    roundTrip,
    waypoints,
    departure,
  });

  return (
    <Card
      className="absolute z-10 w-84 overflow-auto overscroll-contain"
      style={{
        padding: 10,
        top: "calc(1rem + env(safe-area-inset-top, 0px))",
        left: "calc(1rem + env(safe-area-inset-left, 0px))",
        maxHeight:
          "calc(100dvh - 2rem - env(safe-area-inset-top, 0px) - env(safe-area-inset-bottom, 0px))",
      }}
    >
      <CardHeader className="pb-2 flex flex-row items-center justify-between gap-2">
        <CardTitle>Float Plan</CardTitle>
        <select
          value={selectedRegionId}
          onChange={(e) => onRegionSelect(e.target.value)}
          className="border rounded px-2 py-1 text-base md:text-sm bg-background"
          aria-label="Region"
        >
          {regions.map((region) => (
            <option key={region.id} value={region.id}>
              {region.name}
            </option>
          ))}
        </select>
      </CardHeader>
      <CardContent>
        <div className="text-sm">
          <PlanSection
            hasRoute={summary.hasRoute}
            departureDate={departureDate}
            onDepartureDateChange={onDepartureDateChange}
            departureTime={departureTime}
            onDepartureTimeChange={onDepartureTimeChange}
            onSweepDepartures={onSweepDepartures}
            departure={departure}
            timezone={timezone}
            vesselType={vesselType}
            onVesselTypeChange={onVesselTypeChange}
            speedKnots={speedKnots}
            onSpeedChange={onSpeedChange}
          />
          <WeatherSection weather={weather} />
          {summary.hasRoute && (
            <RouteSection
              summary={summary}
              tidalResult={tidalResult}
              tidalLoading={tidalLoading}
              roundTrip={roundTrip}
              onRoundTripChange={onRoundTripChange}
              waypoints={waypoints}
              onStopChange={onStopChange}
              departure={departure}
              timezone={timezone}
              routeNotes={routeNotes}
              onClear={onClear}
            />
          )}
        </div>
      </CardContent>
    </Card>
  );
}
