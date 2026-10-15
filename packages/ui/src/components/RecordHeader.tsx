import type { ReactNode } from "react";
import { Badge, type BadgeTone } from "./Badge.tsx";

export interface RecordField {
  label: string;
  value: ReactNode;
}

/** Record heading bar: title, status, owner and a few key fields. */
export function RecordHeader({
  title,
  status,
  owner,
  fields = [],
}: {
  title: string;
  status: { label: string; tone?: BadgeTone };
  owner: string | null;
  fields?: RecordField[];
}) {
  const all: RecordField[] = [{ label: "Owner", value: owner ?? "Unassigned" }, ...fields];
  return (
    <header className="rounded-lg border bg-card p-5 text-card-foreground shadow-xs">
      <h1 className="flex flex-wrap items-center gap-3 text-xl font-semibold tracking-tight">
        {title} <Badge tone={status.tone}>{status.label}</Badge>
      </h1>
      <dl className="mt-4 flex flex-wrap gap-x-10 gap-y-3">
        {all.map((f) => (
          <div key={f.label}>
            <dt className="text-xs font-medium text-muted-foreground">{f.label}</dt>
            <dd className="mt-1 text-sm text-foreground">{f.value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}
