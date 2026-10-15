import { EmptyState } from "./EmptyState.tsx";

export interface TimelineItem {
  id: string | number;
  occurredAt: Date;
  actor: string | null;
  action: string;
  /** Short description of what changed. */
  summary?: string;
  reason?: string | null;
}

/** Record audit history: who, when, what changed and why. Sorted newest first. */
export function Timeline({ label = "History", items }: { label?: string; items: TimelineItem[] }) {
  const sorted = [...items].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  if (sorted.length === 0) return <EmptyState title="No history yet" />;
  return (
    <ol className="rounded-lg border bg-card text-card-foreground shadow-xs" aria-label={label}>
      {sorted.map((item) => (
        <li key={item.id} className="flex gap-3 border-b px-4 py-3 last:border-0">
          <span aria-hidden className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/70 ring-4 ring-primary/10" />
          <div className="min-w-0 flex-1">
            <div className="text-sm">
              <strong className="font-medium">{item.action}</strong>
              {item.summary ? <span className="text-muted-foreground">{` — ${item.summary}`}</span> : null}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground">
              {item.actor ?? "system"} ·{" "}
              <time dateTime={item.occurredAt.toISOString()}>{item.occurredAt.toISOString().replace("T", " ").slice(0, 19)} UTC</time>
            </div>
            {item.reason ? (
              <div className="mt-2 border-l-2 pl-3 text-sm text-muted-foreground">Reason: {item.reason}</div>
            ) : null}
          </div>
        </li>
      ))}
    </ol>
  );
}
