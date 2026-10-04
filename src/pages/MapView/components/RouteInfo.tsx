import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DepartureSweep, TidalRouteResult, VesselType } from "../../../services/tidalRoute";
import { Weather } from "../../../services/nws";
import { Waypoint } from "../MapView.types";
import { summarizeRoute } from "../routeSummary";
import { Region, RouteNote } from "../../../regions";
import PlanSection from "./PlanSection";
import WeatherSection from "./WeatherSection";
import RouteSection from "./RouteSection";
import RouteSheet from "./RouteSheet";
import TripSummary from "./TripSummary";
import { DESKTOP_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";

const FEEDBACK_URL =
  "https://docs.google.com/forms/d/e/1FAIpQLSfUTkosdeAhwBBKAguprepGYbdD1145KtpQ--Ahzc7BvbM5Sg/viewform";

interface RouteInfoProps {
  totalDistance: number;
  onClear: () => void;
  /** Removes the last waypoint. */
  onUndo: () => void;
  /** Shows the float plan card for a screenshot. */
  onShare: () => void;
  tidalResult: TidalRouteResult | null;
  tidalLoading: boolean;
  /** The tide/wind fetch failed. */
  tidalFailed: boolean;
  /** Fetches tide and wind data for the current route again. */
  onRetryTides: () => void;
  speedKnots: number;
  onSpeedChange: (speed: number) => void;
  departureTime: string;
  onDepartureTimeChange: (time: string) => void;
  departureDate: string;
  onDepartureDateChange: (date: string) => void;
  vesselType: VesselType;
  onVesselTypeChange: (vessel: VesselType) => void;
  weather: Weather;
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
  onUndo,
  onShare,
  tidalResult,
  tidalLoading,
  tidalFailed,
  onRetryTides,
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
    tidalFailed,
    speedKnots,
    roundTrip,
    waypoints,
    departure,
  });

  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  const regionSelect = (
    <select
      value={selectedRegionId}
      onChange={(e) => onRegionSelect(e.target.value)}
      className="border rounded text-base md:text-sm bg-background"
      style={{ padding: "4px 8px" }}
      aria-label="Region"
    >
      {regions.map((region) => (
        <option key={region.id} value={region.id}>
          {region.name}
        </option>
      ))}
    </select>
  );

  const sections = (
    <>
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
      <WeatherSection weather={weather} timezone={timezone} />
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
          onRetryTides={onRetryTides}
          onClear={onClear}
          onUndo={onUndo}
          onShare={onShare}
        />
      )}
      <p className="py-2 text-center text-xs text-muted-foreground">
        Something wrong or an idea?{" "}
        <a
          href={FEEDBACK_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="font-medium text-foreground underline underline-offset-2"
        >
          Send feedback
        </a>
      </p>
    </>
  );

  if (!isDesktop) {
    return (
      <RouteSheet
        summary={
          <TripSummary
            summary={summary}
            roundTrip={roundTrip}
            departure={departure}
            timezone={timezone}
            waypointCount={waypoints.length}
            onUndo={onUndo}
            onShare={onShare}
          />
        }
        headerAction={regionSelect}
      >
        <div style={{ padding: "0 10px" }}>{sections}</div>
      </RouteSheet>
    );
  }

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
        {regionSelect}
      </CardHeader>
      <CardContent>
        <div className="text-sm">{sections}</div>
      </CardContent>
    </Card>
  );
}
