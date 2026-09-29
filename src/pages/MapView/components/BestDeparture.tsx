import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DepartureOption, DepartureSweep } from "../../../services/tidalRoute";
import { formatClock, formatHourTick, toTimeInputValue, zonedHour } from "../../../lib/time";

// Chart geometry (SVG user units; the SVG scales to the panel width).
const WIDTH = 300;
const HEIGHT = 130;
const PAD = { top: 10, right: 8, bottom: 20, left: 30 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

const LINE_COLOR = "#2563eb"; // matches the route line on the map
const STALL_COLOR = "#dc2626"; // matches stalled legs on the map
const BEST_COLOR = "#16a34a";

function formatDuration(hours: number) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

interface BestDepartureProps {
  /** Runs the sweep for a window given as "HH:MM" strings on the selected date. */
  onSweep: (windowStart: string, windowEnd: string) => DepartureSweep | null;
  onUseTime: (time: string) => void;
  /** The currently selected departure, marked on the chart. */
  departure: Date;
  /** Region's IANA zone; times are shown and returned in it. */
  timezone: string;
}

export default function BestDeparture({ onSweep, onUseTime, departure, timezone }: BestDepartureProps) {
  const [windowStart, setWindowStart] = useState("06:00");
  const [windowEnd, setWindowEnd] = useState("20:00");
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const sweep = useMemo(
    () => (windowStart < windowEnd ? onSweep(windowStart, windowEnd) : null),
    [onSweep, windowStart, windowEnd],
  );

  return (
    <div className="rounded-md border border-border bg-background space-y-2" style={{ padding: 6 }}>
      <div className="font-bold text-xs uppercase tracking-wide text-foreground">Best departure</div>
      <div className="flex flex-wrap items-center gap-1 text-xs">
        <span className="text-muted-foreground">Leave between</span>
        <Input
          type="time"
          value={windowStart}
          onChange={(e) => setWindowStart(e.target.value)}
          className="w-24 h-7 text-xs"
          aria-label="Earliest departure"
        />
        <span className="text-muted-foreground">and</span>
        <Input
          type="time"
          value={windowEnd}
          onChange={(e) => setWindowEnd(e.target.value)}
          className="w-24 h-7 text-xs"
          aria-label="Latest departure"
        />
      </div>

      {!sweep && (
        <p className="text-xs text-muted-foreground">
          {windowStart < windowEnd ? "Waiting for tide data…" : "The end of the window must be after the start."}
        </p>
      )}

      {sweep && (
        <>
          <SweepChart
            sweep={sweep}
            hoverIndex={hoverIndex}
            onHover={setHoverIndex}
            onPick={(option) => onUseTime(toTimeInputValue(option.departure, timezone))}
            departure={departure}
            timezone={timezone}
          />
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <LegendSwatch color={BEST_COLOR} label="Best window" />
            <LegendSwatch color={STALL_COLOR} label="Can't make headway" />
          </div>

          {sweep.best && sweep.bestWindow ? (
            <div className="space-y-2 text-xs">
              <p>
                Fastest: leave at <span className="font-medium">{formatClock(sweep.best.departure, timezone)}</span>{" "}
                for <span className="font-medium">{formatDuration(sweep.best.durationHours)}</span>.
              </p>
              <Button
                size="sm"
                className="w-full"
                onClick={() => onUseTime(toTimeInputValue(sweep.best!.departure, timezone))}
              >
                Use {formatClock(sweep.best.departure, timezone)}
              </Button>
            </div>
          ) : (
            <p className="text-xs text-red-700">
              Every departure in this window hits current stronger than your speed. Try a wider window or a faster
              speed.
            </p>
          )}
        </>
      )}
    </div>
  );
}

function LegendSwatch({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block w-3 h-3 rounded-sm" style={{ backgroundColor: color, opacity: 0.35 }} />
      {label}
    </span>
  );
}

interface SweepChartProps {
  sweep: DepartureSweep;
  hoverIndex: number | null;
  onHover: (index: number | null) => void;
  onPick: (option: DepartureOption) => void;
  departure: Date;
  timezone: string;
}

function SweepChart({ sweep, hoverIndex, onHover, onPick, departure, timezone }: SweepChartProps) {
  const { options, bestWindow } = sweep;
  const t0 = options[0].departure.getTime();
  const t1 = options[options.length - 1].departure.getTime();
  const span = Math.max(t1 - t0, 1);

  // Y axis from 0 to a clean half-hour above the slowest trip.
  const maxHours = Math.max(...options.map((o) => o.durationHours));
  const yMax = Math.max(0.5, Math.ceil(maxHours * 2) / 2);
  const yTickStep = yMax <= 2 ? 0.5 : yMax <= 5 ? 1 : 2;
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax + 1e-9; v += yTickStep) yTicks.push(v);

  const x = (t: number) => PAD.left + ((t - t0) / span) * PLOT_W;
  const y = (hours: number) => PAD.top + PLOT_H - (hours / yMax) * PLOT_H;
  const stepPx = options.length > 1 ? PLOT_W / (options.length - 1) : PLOT_W;

  // X ticks on whole hours of the region's clock, every 1-4h depending on the
  // window length. (US zones are whole-hour offsets, so UTC hour boundaries are
  // local hour boundaries too.)
  const hourMs = 3600 * 1000;
  const tickEvery = span > 10 * hourMs ? 4 : span > 4 * hourMs ? 2 : 1;
  const xTicks: Date[] = [];
  for (let t = Math.ceil(t0 / hourMs) * hourMs; t <= t1; t += hourMs) {
    const d = new Date(t);
    if (zonedHour(d, timezone) % tickEvery === 0) xTicks.push(d);
  }

  const linePoints = options.map((o) => `${x(o.departure.getTime())},${y(o.durationHours)}`).join(" ");
  const areaPoints = `${x(t0)},${y(0)} ${linePoints} ${x(t1)},${y(0)}`;

  // Current departure time, if it falls inside the window.
  const current = departure;
  const showCurrent = current.getTime() >= t0 && current.getTime() <= t1;

  const hovered = hoverIndex !== null ? options[hoverIndex] : null;

  function indexAt(clientX: number, svg: SVGSVGElement) {
    const rect = svg.getBoundingClientRect();
    const svgX = ((clientX - rect.left) / rect.width) * WIDTH;
    const i = Math.round((svgX - PAD.left) / stepPx);
    return Math.min(options.length - 1, Math.max(0, i));
  }

  const best = sweep.best;
  const summary = best
    ? `Trip duration by departure time. Fastest is ${formatClock(best.departure, timezone)} at ${formatDuration(best.durationHours)}.`
    : "Trip duration by departure time. Every departure in this window stalls.";

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full cursor-crosshair select-none"
        role="img"
        aria-label={summary}
        onPointerMove={(e) => onHover(indexAt(e.clientX, e.currentTarget))}
        onPointerLeave={() => onHover(null)}
        onClick={(e) => onPick(options[indexAt(e.clientX, e.currentTarget)])}
      >
        {/* Stalled departures: shaded bands, one step wide each. */}
        {options.map((o, i) =>
          o.stalled ? (
            <rect
              key={`stall-${i}`}
              x={Math.max(PAD.left, x(o.departure.getTime()) - stepPx / 2)}
              y={PAD.top}
              width={Math.min(stepPx, PLOT_W)}
              height={PLOT_H}
              fill={STALL_COLOR}
              opacity={0.15}
            />
          ) : null,
        )}

        {/* Best window band. */}
        {bestWindow && (
          <rect
            x={Math.max(PAD.left, x(bestWindow.start.getTime()) - stepPx / 2)}
            y={PAD.top}
            width={Math.max(
              stepPx,
              Math.min(x(bestWindow.end.getTime()) + stepPx / 2, PAD.left + PLOT_W) -
                Math.max(PAD.left, x(bestWindow.start.getTime()) - stepPx / 2),
            )}
            height={PLOT_H}
            fill={BEST_COLOR}
            opacity={0.18}
          />
        )}

        {/* Grid + y ticks. */}
        {yTicks.map((v) => (
          <g key={`y-${v}`}>
            <line x1={PAD.left} x2={PAD.left + PLOT_W} y1={y(v)} y2={y(v)} className="stroke-border" strokeWidth={1} />
            <text x={PAD.left - 4} y={y(v)} dy="0.32em" textAnchor="end" fontSize={9} className="fill-muted-foreground">
              {v === 0 ? "0" : `${v}h`}
            </text>
          </g>
        ))}
        {xTicks.map((d) => (
          <text
            key={`x-${d.getTime()}`}
            x={x(d.getTime())}
            y={HEIGHT - 6}
            textAnchor="middle"
            fontSize={9}
            className="fill-muted-foreground"
          >
            {formatHourTick(d, timezone)}
          </text>
        ))}

        {/* Duration line with a light wash beneath. */}
        <polygon points={areaPoints} fill={LINE_COLOR} opacity={0.1} />
        <polyline
          points={linePoints}
          fill="none"
          stroke={LINE_COLOR}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Currently selected departure. */}
        {showCurrent && (
          <line
            x1={x(current.getTime())}
            x2={x(current.getTime())}
            y1={PAD.top}
            y2={PAD.top + PLOT_H}
            className="stroke-foreground"
            strokeWidth={1}
            strokeDasharray="2 2"
          />
        )}

        {/* Best point marker. */}
        {best && (
          <circle
            cx={x(best.departure.getTime())}
            cy={y(best.durationHours)}
            r={4}
            fill={BEST_COLOR}
            className="stroke-background"
            strokeWidth={2}
          />
        )}

        {/* Hover crosshair. */}
        {hovered && (
          <>
            <line
              x1={x(hovered.departure.getTime())}
              x2={x(hovered.departure.getTime())}
              y1={PAD.top}
              y2={PAD.top + PLOT_H}
              className="stroke-muted-foreground"
              strokeWidth={1}
            />
            <circle
              cx={x(hovered.departure.getTime())}
              cy={y(hovered.durationHours)}
              r={4}
              fill={LINE_COLOR}
              className="stroke-background"
              strokeWidth={2}
            />
          </>
        )}
      </svg>

      {hovered && (
        <div
          className="pointer-events-none absolute top-0 rounded border border-border bg-popover text-popover-foreground shadow-sm text-xs whitespace-nowrap"
          style={{
            padding: "2px 6px",
            left: `${(x(hovered.departure.getTime()) / WIDTH) * 100}%`,
            transform: `translateX(${x(hovered.departure.getTime()) > WIDTH / 2 ? "-105%" : "5%"})`,
          }}
        >
          <div className="font-medium">Leave {formatClock(hovered.departure, timezone)}</div>
          <div>
            {hovered.stalled ? "≥ " : ""}
            {formatDuration(hovered.durationHours)}
            {hovered.stalled && " · can't make headway"}
          </div>
          <div className="text-muted-foreground">Click to use</div>
        </div>
      )}
    </div>
  );
}
