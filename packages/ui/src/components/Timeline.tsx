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
    <ol className="fit-timeline" aria-label={label}>
      {sorted.map((item) => (
        <li key={item.id}>
          <div>
            <strong>{item.action}</strong>
            {item.summary ? ` — ${item.summary}` : null}
          </div>
          <div className="fit-timeline__meta">
            {item.actor ?? "system"} · <time dateTime={item.occurredAt.toISOString()}>{item.occurredAt.toISOString().replace("T", " ").slice(0, 19)} UTC</time>
          </div>
          {item.reason ? <div className="fit-timeline__reason">Reason: {item.reason}</div> : null}
        </li>
      ))}
    </ol>
  );
}
