import { ReactNode } from "react";

/** A titled block of the float plan panel. */
export default function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div
      className="flex flex-col gap-3 rounded-md border border-border bg-muted/30"
      style={{ padding: "6px", margin: "6px" }}
    >
      <div className="font-bold text-sm uppercase tracking-wide text-foreground">
        {title}
      </div>
      {children}
    </div>
  );
}
