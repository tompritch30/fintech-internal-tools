import { ChevronLeft } from "lucide-react";
import { Badge, type BadgeTone } from "./Badge.tsx";
import { FieldList, type RecordField } from "./RecordSection.tsx";
import { StatusBadge, type StatusValue } from "./StatusBadge.tsx";

/** Record heading: title, status and owner. Everything else goes in a RecordSection. */
export function RecordHeader({
  title,
  status,
  owner,
  ownerLabel = "Owner",
  back,
  fields,
}: {
  title: string;
  /** `tone` is the old API, kept until the flags app moves to `kind`. */
  status: StatusValue & { tone?: BadgeTone };
  owner: string | null;
  ownerLabel?: string;
  /** Link back to the record's list. */
  back?: { href: string; label: string };
  /** @deprecated Old API, kept for the flags app. Put fields in a RecordSection. */
  fields?: RecordField[];
}) {
  return (
    <header className="flex flex-col gap-2">
      {back ? (
        <a href={back.href} className="inline-flex w-fit items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ChevronLeft aria-hidden className="size-4" />
          {back.label}
        </a>
      ) : null}
      <h1 className="flex flex-wrap items-center gap-3">
        {title} {status.tone ? <Badge tone={status.tone}>{status.label}</Badge> : <StatusBadge label={status.label} kind={status.kind} />}
      </h1>
      <p className="text-sm text-muted-foreground">
        {ownerLabel}: <span className="font-medium text-foreground">{owner ?? "Unassigned"}</span>
      </p>
      {fields?.length ? <FieldList fields={fields} /> : null}
    </header>
  );
}
