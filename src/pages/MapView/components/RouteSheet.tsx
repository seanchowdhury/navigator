import { ReactNode, useEffect, useState } from "react";
import { useMap } from "react-map-gl/maplibre";
import { Drawer } from "vaul";

/** Collapsed (summary only), half screen, and full screen. */
const SNAP_POINTS = ["112px", 0.5, 1];

/**
 * Pixels of map the sheet covers at a snap point. Capped at half the screen:
 * at full height the map is hidden anyway, and keeping the half-height view
 * means it's where you left it when the sheet comes back down.
 */
function coveredPixels(snap: number | string | null) {
  if (typeof snap === "string") return parseFloat(snap);
  return Math.min(snap ?? 0, 0.5) * window.innerHeight;
}

interface RouteSheetProps {
  /** Always visible, including when collapsed. */
  summary: ReactNode;
  /** Shown beside the title (e.g. the region picker). */
  headerAction?: ReactNode;
  children: ReactNode;
}

/**
 * The float plan as a bottom sheet for phones. It never closes and never
 * blocks the map, so waypoints can be placed at any snap point.
 */
export default function RouteSheet({ summary, headerAction, children }: RouteSheetProps) {
  const [snap, setSnap] = useState<number | string | null>(SNAP_POINTS[0]);
  const expanded = snap === 1;
  const { routeMap } = useMap();

  // Keep the camera centered in the part of the map the sheet leaves visible,
  // so flyTo and the route land above the sheet rather than behind it.
  useEffect(() => {
    if (!routeMap) return;
    routeMap.easeTo({ padding: { bottom: coveredPixels(snap) }, duration: 300 });
  }, [routeMap, snap]);

  // Switching to the desktop card unmounts the sheet; give the map back its full height.
  useEffect(() => {
    if (!routeMap) return;
    return () => {
      routeMap.easeTo({ padding: { bottom: 0 }, duration: 300 });
    };
  }, [routeMap]);

  return (
    <Drawer.Root
      open
      modal={false}
      dismissible={false}
      noBodyStyles
      snapPoints={SNAP_POINTS}
      activeSnapPoint={snap}
      setActiveSnapPoint={setSnap}
    >
      <Drawer.Portal>
        <Drawer.Content
          aria-describedby={undefined}
          // Radix focuses the first input on open, which would pop the keyboard on load.
          onOpenAutoFocus={(e) => e.preventDefault()}
          className="fixed inset-x-0 bottom-0 z-10 flex h-full max-h-[97%] flex-col rounded-t-xl border-t border-border bg-background text-foreground shadow-[0_-4px_16px_rgba(0,0,0,0.12)] outline-none"
        >
          <div
            className="h-1.5 w-12 shrink-0 self-center rounded-full bg-muted-foreground/30"
            style={{ margin: "8px 0" }}
          />
          <div className="shrink-0" style={{ padding: "0 16px 12px" }}>
            {summary}
          </div>
          <div
            className={`flex-1 text-sm ${expanded ? "overflow-y-auto overscroll-contain" : "overflow-hidden"}`}
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="flex items-center justify-between gap-2" style={{ padding: "0 16px" }}>
              <Drawer.Title className="font-heading text-base font-medium">Float Plan</Drawer.Title>
              {headerAction}
            </div>
            {children}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
