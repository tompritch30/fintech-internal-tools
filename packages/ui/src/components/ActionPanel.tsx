import { Children, type ReactNode } from "react";
import { Info } from "lucide-react";

/**
 * The record's one action bar. Pass only actions the current user can actually take;
 * when there are none, the panel shows `waiting` as a neutral status line instead.
 * Presentational only: the server still checks every action.
 */
export function ActionPanel({
  label,
  waiting,
  note,
  children,
}: {
  label: string;
  /** Shown when there are no actions, e.g. "Waiting for a different approver". */
  waiting: string;
  /** Optional hint shown under the actions (e.g. an approval threshold). */
  note?: ReactNode;
  children?: ReactNode;
}) {
  const actions = Children.toArray(children);
  if (actions.length === 0) {
    return (
      <p role="status" aria-label={label} className="flex items-center gap-2 rounded-lg border bg-muted/50 px-4 py-3 text-sm text-muted-foreground">
        <Info aria-hidden className="size-4 shrink-0" />
        {waiting}
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-2 rounded-lg border bg-card p-3 text-card-foreground shadow-xs">
      <div role="toolbar" aria-label={label} className="flex flex-wrap items-start gap-2">
        {actions}
      </div>
      {note ? <p className="text-xs text-muted-foreground">{note}</p> : null}
    </div>
  );
}
