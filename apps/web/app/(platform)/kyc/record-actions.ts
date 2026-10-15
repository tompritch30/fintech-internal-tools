/**
 * Which actions the current user can take on a KYC case, or what the case is waiting for.
 * The page renders only these; the server actions still enforce every rule.
 */

interface Viewer {
  id: string;
  permissions: ReadonlySet<string>;
}

export type KycCaseAction = "claim" | "approve" | "reject" | "escalate" | "signOff" | "refuseSignOff";

export interface KycAvailableActions {
  actions: KycCaseAction[];
  /** Neutral status line shown when `actions` is empty. */
  waiting: string;
}

export function caseActions(
  user: Viewer,
  kase: { status: string; ownerId: string | null; ownerName: string | null; approval: { status: string; requestedBy: string } | null },
): KycAvailableActions {
  const analyst = user.permissions.has("kyc:request");
  switch (kase.status) {
    case "open":
    case "escalated":
      return analyst ? { actions: ["claim"], waiting: "" } : { actions: [], waiting: "Waiting for an analyst to claim this case." };
    case "in_review":
      if (analyst && kase.ownerId === user.id) return { actions: ["approve", "reject", "escalate"], waiting: "" };
      return { actions: [], waiting: `Claimed by ${kase.ownerName ?? "another analyst"}. Only they can decide it.` };
    case "pending_approval": {
      const signOff = kase.approval?.status === "pending" ? kase.approval : null;
      if (!signOff) return { actions: [], waiting: "Waiting for a different approver to sign off." };
      if (signOff.requestedBy === user.id) return { actions: [], waiting: "You asked for this sign-off. Waiting for a different approver." };
      if (!user.permissions.has("kyc:approve")) return { actions: [], waiting: "Waiting for a different approver to sign off." };
      return { actions: ["signOff", "refuseSignOff"], waiting: "" };
    }
    case "approved":
      return { actions: [], waiting: "Approved and closed. Nothing more to do." };
    case "rejected":
      return { actions: [], waiting: "Rejected and closed. Nothing more to do." };
    default:
      return { actions: [], waiting: "No actions available." };
  }
}
