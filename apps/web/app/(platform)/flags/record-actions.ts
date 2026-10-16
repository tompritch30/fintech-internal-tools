/**
 * Which actions the current user can take on a feature flag, or what it is waiting for.
 * The page renders only these; the server actions still enforce every rule.
 */

interface Viewer {
  id: string;
  permissions: ReadonlySet<string>;
}

export type FlagAction = "change" | "kill" | "approve" | "reject";

export interface FlagAvailableActions {
  actions: FlagAction[];
  /** Neutral status line: shown in place of the actions, or next to them while a prod change waits. */
  waiting: string;
}

export function flagActions(
  user: Viewer,
  flag: { prodEnabled: boolean; prodVersion: number; pending: { requestedBy: string; baseVersion: number } | null },
): FlagAvailableActions {
  const actions: FlagAction[] = [];
  if (user.permissions.has("flags:request")) {
    actions.push("change");
    if (flag.prodEnabled) actions.push("kill");
  }
  const { pending } = flag;
  // Prod moved on (e.g. the kill switch) since the request: the server refuses approval, so only reject is left.
  const stale = pending !== null && pending.baseVersion !== flag.prodVersion;
  if (pending && user.permissions.has("flags:approve") && pending.requestedBy !== user.id) {
    actions.push(...(stale ? (["reject"] as const) : (["approve", "reject"] as const)));
  }
  let waiting = "No changes pending. Changing a flag needs the analyst role.";
  if (pending) {
    waiting = stale
      ? "Prod changed after this was requested, so it can't be approved. Reject it so it can be requested again."
      : pending.requestedBy === user.id
        ? "You requested this prod change. Waiting for a different approver."
        : actions.includes("approve")
          ? "A prod change is waiting for your decision."
          : "A prod change is waiting for approval.";
    if (actions.includes("kill")) waiting += " You can still turn the flag off in prod.";
  }
  return { actions, waiting };
}
