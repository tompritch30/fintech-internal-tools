import Link from "next/link";
import { notFound } from "next/navigation";
import type { AuditListItem } from "@fit/core";
import { ActionDialog, ActionPanel, Input, RecordHeader, RecordSection, Timeline, linkClass } from "@fit/ui";
import { withActorNames } from "../../../../../lib/actor-names.ts";
import { getDb, requirePagePermission } from "../../../../../lib/auth.ts";
import { approveRefundAction, rejectRefundAction } from "../../actions.ts";
import { formatPence, formatWhen, statusOf } from "../../format.ts";
import { refundActions } from "../../record-actions.ts";
import { getRefundView, refundHistory } from "../../refunds.ts";

function summary(h: AuditListItem): string | undefined {
  const after = (h.after ?? {}) as { amountPence?: number; providerRefundId?: string; requiresApproval?: boolean };
  switch (h.action) {
    case "refund.requested":
      return after.amountPence === undefined
        ? undefined
        : `${formatPence(after.amountPence)} requested${after.requiresApproval ? ", needs approval" : ""}`;
    case "refund.succeeded":
      return `money returned through the payment provider (${after.providerRefundId ?? "unknown id"})`;
    case "approval.requested":
      return "sent to the approvals queue";
    case "approval.approved":
      return "approved";
    case "approval.rejected":
      return "rejected; no money moved";
    case "approval.cancelled":
      return "cancelled by the requester";
    default:
      return undefined;
  }
}

const APPROVAL_STATUS: Record<string, string> = { pending: "Waiting for approval", approved: "Approved", rejected: "Rejected", cancelled: "Cancelled" };

export default async function RefundPage({ params }: { params: Promise<{ refundId: string }> }) {
  const { refundId } = await params;
  const user = await requirePagePermission("refunds:read", `/refunds/requests/${refundId}`);
  const db = getDb();
  const refund = await getRefundView(db, refundId);
  if (!refund) notFound();
  const history = await withActorNames(db, await refundHistory(db, refund.id));
  const { actions, waiting } = refundActions(user, refund);
  const decision = { refundId: refund.id, expectedVersion: refund.approval?.version ?? 0 };

  return (
    <div className="stack">
      <RecordHeader
        back={{ href: user.permissions.has("refunds:approve") ? "/refunds/approvals" : "/refunds", label: user.permissions.has("refunds:approve") ? "Approvals" : "Payments" }}
        title={`Refund ${refund.id.slice(0, 8)} · ${formatPence(refund.amountPence)}`}
        status={statusOf(refund.status)}
        owner={refund.requestedByName}
        ownerLabel="Requested by"
      />
      <ActionPanel label="Refund actions" waiting={waiting}>
        {actions.includes("approve") ? (
          <ActionDialog label="Approve refund" variant="primary" description="The refund is sent to the payment provider straight away." action={approveRefundAction} hidden={decision}>
            <Input id="approve-note" name="note" label="Approval note (optional)" maxLength={500} />
          </ActionDialog>
        ) : null}
        {actions.includes("reject") ? (
          <ActionDialog label="Reject refund" variant="danger" description="No money is moved." action={rejectRefundAction} hidden={decision}>
            <Input id="reject-note" name="note" label="Rejection reason" required maxLength={500} />
          </ActionDialog>
        ) : null}
      </ActionPanel>
      <RecordSection
        title="Details"
        fields={[
          {
            label: "Payment",
            value: (
              <Link className={linkClass} href={`/refunds/payments/${refund.paymentId}`}>
                {refund.paymentReference}
              </Link>
            ),
          },
          { label: "Amount", value: formatPence(refund.amountPence) },
          { label: "Reason", value: refund.reason },
          { label: "Requested", value: formatWhen(refund.requestedAt) },
          { label: "Provider refund", value: refund.providerRefundId ?? "—" },
        ]}
      />
      <RecordSection
        title="Decision"
        fields={
          refund.requiresApproval
            ? [
                { label: "Approval", value: APPROVAL_STATUS[refund.approval?.status ?? ""] ?? "Required" },
                { label: "Decided by", value: refund.approval?.decidedByName ?? "—" },
                { label: "Decision note", value: refund.approval?.decisionNote ?? "—" },
              ]
            : [{ label: "Approval", value: "Not required (at or under the threshold)" }]
        }
      />
      <RecordSection title="History">
        <Timeline
          items={history.map((h) => ({
            id: h.id,
            occurredAt: h.occurredAt,
            actor: h.actorName,
            actorTitle: h.actor,
            action: h.action,
            summary: summary(h),
            reason: h.reason,
          }))}
        />
      </RecordSection>
    </div>
  );
}
