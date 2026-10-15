import type { FlagValue } from "./flags.ts";

export function describeFlagValue(_value: FlagValue): string {
  throw new Error("not implemented");
}

/** Timeline summary for a flag audit row, e.g. "prod: Off · 0% → On · 25%". */
export function describeFlagAudit(_after: unknown): string | undefined {
  throw new Error("not implemented");
}
