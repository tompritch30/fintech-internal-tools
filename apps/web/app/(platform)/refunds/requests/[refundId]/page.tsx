import Link from "next/link";
import { notFound } from "next/navigation";
import type { AuditListItem } from "@fit/core";
import { CommandBar, RecordHeader, Timeline } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../../../lib/auth.ts";
import { DecisionForms } from "../../forms.tsx";
import { formatPence, formatWhen, STATUS } from "../../format.ts";
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

export default async function RefundPage({ params }: { params: Promise<{ refundId: string }> }) {
  const { refundId } = await params;
  const user = await requirePagePermission("refunds:read", `/refunds/requests/${refundId}`);
  const db = getDb();
  const refund = await getRefundView(db, refundId);
  if (!refund) notFound();
  const history = await refundHistory(db, refund.id);
  const status = STATUS[refund.status] ?? { label: refund.status, tone: "neutral" as const };
  const awaiting = refund.status === "pending_approval" && refund.approval?.status === "pending";
  const canDecide = awaiting && user.permissions.has("refunds:approve");
  const isRequester = refund.requestedBy === user.id;

  return (
    <div className="stack">
      <RecordHeader
        title={`Refund ${refund.id.slice(0, 8)} · ${formatPence(refund.amountPence)}`}
        status={status}
        owner={refund.requestedByName}
        fields={[
          {
            label: "Payment",
            value: (
              <Link className="underline underline-offset-4" href={`/refunds/payments/${refund.paymentId}`}>
                {refund.paymentReference}
              </Link>
            ),
          },
          { label: "Reason", value: refund.reason },
          { label: "Requested", value: formatWhen(refund.requestedAt) },
          { label: "Approval", value: refund.requiresApproval ? (refund.approval?.decidedByName ?? "Required") : "Not required" },
          { label: "Provider refund", value: refund.providerRefundId ?? "—" },
        ]}
      />
      {canDecide && refund.approval ? (
        <CommandBar label="Refund actions">
          {isRequester ? (
            <p className="w-full text-sm text-muted-foreground">
              You requested this refund. A different approver has to decide it; the server will refuse your approval.
            </p>
          ) : null}
          <DecisionForms refundId={refund.id} version={refund.approval.version} />
        </CommandBar>
      ) : awaiting ? (
        <p>Waiting for an approver. Nothing has been paid yet.</p>
      ) : null}
      <h2>History</h2>
      <Timeline
        items={history.map((h) => ({
          id: h.id,
          occurredAt: h.occurredAt,
          actor: h.actor,
          action: h.action,
          summary: summary(h),
          reason: h.reason,
        }))}
      />
    </div>
  );
}
