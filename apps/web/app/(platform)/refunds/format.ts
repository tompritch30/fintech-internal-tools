import type { BadgeTone } from "@fit/ui";

/** Shared by server pages and client forms, so no server-only imports here. */
export interface FormState {
  error?: string;
  message?: string;
  revealed?: string;
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export const formatPence = (pence: number) => gbp.format(pence / 100);

export const formatWhen = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

export const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  pending_approval: { label: "Pending approval", tone: "warning" },
  succeeded: { label: "Refunded", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};
