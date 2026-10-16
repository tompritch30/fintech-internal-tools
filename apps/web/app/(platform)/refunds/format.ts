import type { StatusValue } from "@fit/ui";

/** Shared by server pages and client forms, so no server-only imports here. */
export interface FormState {
  error?: string;
  message?: string;
  revealed?: string;
}

const gbp = new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" });

export const formatPence = (pence: number) => gbp.format(pence / 100);

export const formatWhen = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;

/** Status kinds: neutral unless done. Refunds carry no risk flag of their own. */
export const STATUS: Record<string, StatusValue> = {
  pending_approval: { label: "Pending approval", kind: "neutral" },
  succeeded: { label: "Refunded", kind: "done" },
  rejected: { label: "Rejected", kind: "neutral" },
  cancelled: { label: "Cancelled", kind: "neutral" },
};

export const statusOf = (status: string): StatusValue => STATUS[status] ?? { label: status };

/** "Captured", "Partially refunded" once some money has gone back, "Fully refunded" when all of it has. */
export function paymentStatus(p: { amountPence: number; refundedPence: number }): StatusValue {
  if (p.refundedPence >= p.amountPence) return { label: "Fully refunded", kind: "done" };
  if (p.refundedPence > 0) return { label: "Partially refunded" };
  return { label: "Captured" };
}
