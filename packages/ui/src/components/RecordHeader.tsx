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
  return (
    <header className="fit-record-header">
      <h1>
        {title} <Badge tone={status.tone}>{status.label}</Badge>
      </h1>
      <dl>
        <div>
          <dt>Owner</dt>
          <dd>{owner ?? "Unassigned"}</dd>
        </div>
        {fields.map((f) => (
          <div key={f.label}>
            <dt>{f.label}</dt>
            <dd>{f.value}</dd>
          </div>
        ))}
      </dl>
    </header>
  );
}
