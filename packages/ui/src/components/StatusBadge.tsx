import { Badge, type BadgeTone } from "./Badge.tsx";

/**
 * What a status means, not what colour it is. Apps map their statuses to a kind;
 * this is the only place a kind becomes a colour.
 * - neutral: the default for every status (open, in review, pending, rejected, cancelled...)
 * - risk: genuine risk only (high risk rating, sanctions hit, PEP)
 * - done: completed only (refunded, approved and closed)
 */
export type StatusKind = "neutral" | "risk" | "done";

export const STATUS_TONE: Readonly<Record<StatusKind, BadgeTone>> = Object.freeze({
  neutral: "neutral",
  risk: "danger",
  done: "success",
});

export interface StatusValue {
  label: string;
  kind?: StatusKind;
}

export function StatusBadge({ label, kind = "neutral" }: StatusValue) {
  return <Badge tone={STATUS_TONE[kind]}>{label}</Badge>;
}
