import type { ReactNode } from "react";

/**
 * Toolbar for list/record actions (Assign, Approve, Reject...).
 * Presentational only: render only commands the user may run; the server still checks.
 */
export function CommandBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-lg border bg-card p-3 text-card-foreground shadow-xs"
      role="toolbar"
      aria-label={label}
    >
      {children}
    </div>
  );
}
