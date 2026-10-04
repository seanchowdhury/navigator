import { useEffect, useState } from "react";
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
        <DateTimeInput type="date" value={departureDate} onCommit={onDepartureDateChange} />
      </div>
      <div className="flex justify-between items-center">
        <span className="text-muted-foreground">Time</span>
        <DateTimeInput type="time" value={departureTime} onCommit={onDepartureTimeChange} />
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
          className="border rounded text-base md:text-sm bg-background"
          style={{ padding: "4px 8px" }}
        >
          {Object.entries(VESSEL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-2">
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

/**
 * Date or time input that keeps its own draft while editing and only commits
 * complete values. A half-edited field reads as "" (clearing one part of the
 * time, say), which isn't a departure anything downstream can use.
 */
function DateTimeInput({
  type,
  value,
  onCommit,
}: {
  type: "date" | "time";
  value: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);

  // Follow outside changes (e.g. picking a best departure time).
  useEffect(() => {
    setDraft(value);
  }, [value]);

  return (
    <Input
      type={type}
      value={draft}
      onChange={(e) => {
        setDraft(e.target.value);
        if (e.target.value) onCommit(e.target.value);
      }}
      // Left incomplete: show the departure still in use.
      onBlur={() => setDraft(value)}
      className="w-40 text-right"
    />
  );
}
