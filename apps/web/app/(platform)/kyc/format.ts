import type { StatusValue } from "@fit/ui";

/** Shared by server pages and client forms, so no server-only imports here. */
export interface FormState {
  error?: string;
  message?: string;
  revealed?: string;
}

export const formatWhen = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
export const formatDay = (d: Date) => d.toISOString().slice(0, 10);

/** Status kinds: neutral unless done. Risk is shown by the risk badges, not the status. */
export const STATUS: Record<string, StatusValue> = {
  open: { label: "Open" },
  in_review: { label: "In review" },
  pending_approval: { label: "Awaiting sign-off" },
  escalated: { label: "Escalated" },
  approved: { label: "Approved", kind: "done" },
  rejected: { label: "Rejected" },
};

export const statusOf = (status: string): StatusValue => STATUS[status] ?? { label: status };

/** Risk badges: red only for genuine risk (high rating, sanctions hit, PEP). */
export function riskBadges(c: { riskRating: string; highRisk: boolean; sanctionsHit: boolean; pep: boolean }): StatusValue[] {
  const badges: StatusValue[] = [{ label: RISK[c.riskRating] ?? c.riskRating, kind: c.riskRating === "high" ? "risk" : "neutral" }];
  if (c.sanctionsHit) badges.push({ label: "Sanctions hit", kind: "risk" });
  if (c.pep) badges.push({ label: "PEP", kind: "risk" });
  return badges;
}

export const RISK: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };

export const MASKED_FIELDS = {
  applicantName: "full name",
  dateOfBirth: "date of birth",
  idNumber: "ID number",
  address: "address",
} as const;
