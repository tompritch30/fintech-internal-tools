import type { ReactNode } from "react";

/**
 * Toolbar for list/record actions (Assign, Approve, Reject...).
 * Presentational only: render only commands the user may run; the server still checks.
 */
export function CommandBar({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="fit-commandbar" role="toolbar" aria-label={label}>
      {children}
    </div>
  );
}
