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
  flag: { prodEnabled: boolean; pending: { requestedBy: string } | null },
): FlagAvailableActions {
  const actions: FlagAction[] = [];
  if (user.permissions.has("flags:request")) {
    actions.push("change");
    if (flag.prodEnabled) actions.push("kill");
  }
  const { pending } = flag;
  if (pending && user.permissions.has("flags:approve") && pending.requestedBy !== user.id) actions.push("approve", "reject");
  let waiting = "No changes pending. Changing a flag needs the analyst role.";
  if (pending) {
    waiting =
      pending.requestedBy === user.id
        ? "You requested this prod change. Waiting for a different approver."
        : actions.includes("approve")
          ? "A prod change is waiting for your decision."
          : "A prod change is waiting for approval.";
  }
  return { actions, waiting };
}
