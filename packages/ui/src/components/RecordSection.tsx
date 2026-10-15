import type { ReactNode } from "react";

export interface RecordField {
  label: string;
  value: ReactNode;
}

/** Label/value grid used in record sections. */
export function FieldList({ fields }: { fields: RecordField[] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
      {fields.map((f) => (
        <div key={f.label} className="min-w-0">
          <dt className="text-xs font-medium text-muted-foreground">{f.label}</dt>
          <dd className="mt-1 text-sm break-words text-foreground">{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A titled section of a record page (Details, Documents, Decision, History...). */
export function RecordSection({ title, fields, children }: { title: string; fields?: RecordField[]; children?: ReactNode }) {
  const id = `section-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3">
      <h2 id={id}>{title}</h2>
      {fields ? (
        <div className="rounded-lg border bg-card p-5 text-card-foreground shadow-xs">
          <FieldList fields={fields} />
        </div>
      ) : null}
      {children}
    </section>
  );
}
