import { ReactNode } from "react";

/** A titled block of the float plan panel. */
export default function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="rounded-md border border-border bg-muted/30 space-y-3"
      style={{ padding: "6px", margin: "6px" }}
    >
      <div className="font-bold text-sm uppercase tracking-wide text-foreground mb-2">
        {title}
      </div>
      {children}
    </div>
  );
}
