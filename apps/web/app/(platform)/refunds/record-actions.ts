/**
 * Which actions the current user can take on a refunds record, or what the record is waiting for.
 * Pages render only these; the server actions still enforce every rule.
 */

interface Viewer {
  id: string;
  permissions: ReadonlySet<string>;
}

export interface AvailableActions<A extends string> {
  actions: A[];
  /** Neutral status line shown when `actions` is empty. */
  waiting: string;
}

export function paymentActions(
  user: Viewer,
  payment: { availablePence: number; pendingPence: number },
): AvailableActions<"request"> {
  if (payment.availablePence <= 0) {
    return { actions: [], waiting: payment.pendingPence > 0 ? "Nothing left to refund until the pending refunds are decided." : "Fully refunded. Nothing left to refund." };
  }
  if (!user.permissions.has("refunds:request")) return { actions: [], waiting: "View only. Refunds are requested by a refunds analyst." };
  return { actions: ["request"], waiting: "" };
}

export function refundActions(
  user: Viewer,
  refund: { status: string; requestedBy: string; approval: { status: string } | null },
): AvailableActions<"approve" | "reject"> {
  const awaiting = refund.status === "pending_approval" && refund.approval?.status === "pending";
  if (awaiting) {
    if (refund.requestedBy === user.id) return { actions: [], waiting: "You requested this refund. Waiting for a different approver." };
    if (!user.permissions.has("refunds:approve")) return { actions: [], waiting: "Waiting for an approver. Nothing has been paid yet." };
    return { actions: ["approve", "reject"], waiting: "" };
  }
  switch (refund.status) {
    case "succeeded":
      return { actions: [], waiting: "Refunded. Nothing more to do." };
    case "rejected":
      return { actions: [], waiting: "Rejected. No money was moved." };
    case "cancelled":
      return { actions: [], waiting: "Cancelled. No money was moved." };
    default:
      return { actions: [], waiting: "No actions available." };
  }
}
