import { ReactNode, useState } from "react";
import { Drawer } from "vaul";

/** Collapsed (summary only), half screen, and full screen. */
const SNAP_POINTS = ["96px", 0.5, 1];

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
          <div className="mx-auto mt-2 mb-2 h-1.5 w-12 shrink-0 rounded-full bg-muted-foreground/30" />
          <div className="shrink-0 px-4 pb-3">{summary}</div>
          <div
            className={`flex-1 text-sm ${expanded ? "overflow-y-auto overscroll-contain" : "overflow-hidden"}`}
            style={{ paddingBottom: "calc(1rem + env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="flex items-center justify-between gap-2 px-4">
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
