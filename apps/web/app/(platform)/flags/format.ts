import type { FlagValue } from "./flags.ts";

export interface FormState {
  error?: string;
  message?: string;
}

export function describeFlagValue(value: FlagValue): string {
  return `${value.enabled ? "On" : "Off"} · ${value.rolloutPercentage}%`;
}

const isValue = (v: unknown): v is FlagValue =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as FlagValue).enabled === "boolean" &&
  typeof (v as FlagValue).rolloutPercentage === "number";

/** Timeline summary for a flag audit row, e.g. "prod: Off · 0% → On · 25%". */
export function describeFlagAudit(after: unknown): string | undefined {
  if (!isValue(after)) return undefined;
  const { environment, previous } = after as FlagValue & { environment?: unknown; previous?: unknown };
  if (typeof environment !== "string" || !isValue(previous)) return undefined;
  return `${environment}: ${describeFlagValue(previous)} → ${describeFlagValue(after)}`;
}

/** Same format as the other apps: "2026-10-16 05:06 UTC". */
export const formatWhen = (d: Date) => `${d.toISOString().slice(0, 16).replace("T", " ")} UTC`;
