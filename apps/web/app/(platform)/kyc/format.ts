import type { BadgeTone } from "@fit/ui";

/** Shared by server pages and client forms, so no server-only imports here. */
export interface FormState {
  error?: string;
  message?: string;
  revealed?: string;
}

export const formatWhen = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
export const formatDay = (d: Date) => d.toISOString().slice(0, 10);

export const STATUS: Record<string, { label: string; tone: BadgeTone }> = {
  open: { label: "Open", tone: "info" },
  in_review: { label: "In review", tone: "neutral" },
  pending_approval: { label: "Awaiting sign-off", tone: "warning" },
  escalated: { label: "Escalated", tone: "warning" },
  approved: { label: "Approved", tone: "success" },
  rejected: { label: "Rejected", tone: "danger" },
};

export const RISK: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

export const MASKED_FIELDS = {
  applicantName: "full name",
  dateOfBirth: "date of birth",
  idNumber: "ID number",
  address: "address",
} as const;
