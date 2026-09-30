import { useState } from "react";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Clock } from "lucide-react";
import { DepartureSweep, VesselType, VESSEL_LABELS } from "../../../services/tidalRoute";
import BestDeparture from "./BestDeparture";
import Section from "./Section";

interface PlanSectionProps {
  hasRoute: boolean;
  departureDate: string;
  onDepartureDateChange: (date: string) => void;
  departureTime: string;
  onDepartureTimeChange: (time: string) => void;
  onSweepDepartures: (windowStart: string, windowEnd: string) => DepartureSweep | null;
  /** departureDate + departureTime as an instant in the region's time zone. */
  departure: Date;
  timezone: string;
  vesselType: VesselType;
  onVesselTypeChange: (vessel: VesselType) => void;
  speedKnots: number;
  onSpeedChange: (speed: number) => void;
}

export default function PlanSection({
  hasRoute,
  departureDate,
  onDepartureDateChange,
  departureTime,
  onDepartureTimeChange,
  onSweepDepartures,
  departure,
  timezone,
  vesselType,
  onVesselTypeChange,
  speedKnots,
  onSpeedChange,
}: PlanSectionProps) {
  const [showBestDeparture, setShowBestDeparture] = useState(false);

  return (
    <Section title="Departure">
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
          departure={departure}
          timezone={timezone}
        />
      )}
      <div className="flex justify-between items-center">
        <span className="text-muted-foreground">Vessel</span>
        <select
          value={vesselType}
          onChange={(e) => onVesselTypeChange(e.target.value as VesselType)}
          className="border rounded px-2 py-1 text-base md:text-sm bg-background"
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
    </Section>
  );
}
