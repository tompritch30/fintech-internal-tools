import { ChevronLeft } from "lucide-react";
import { StatusBadge, type StatusValue } from "./StatusBadge.tsx";

/** Record heading: title, status and owner. Everything else goes in a RecordSection. */
export function RecordHeader({
  title,
  status,
  owner,
  ownerLabel = "Owner",
  back,
}: {
  title: string;
  status: StatusValue;
  owner: string | null;
  ownerLabel?: string;
  /** Link back to the record's list. */
  back?: { href: string; label: string };
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
        {title} <StatusBadge {...status} />
      </h1>
      <p className="text-sm text-muted-foreground">
        {ownerLabel}: <span className="font-medium text-foreground">{owner ?? "Unassigned"}</span>
      </p>
    </header>
  );
}
