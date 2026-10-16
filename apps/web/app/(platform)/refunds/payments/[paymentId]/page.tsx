import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { MIN_UNMASK_REASON_LENGTH } from "@fit/core";
import { ActionDialog, ActionPanel, Input, RecordHeader, RecordSection, RevealButton, StatusBadge, Table, Timeline, linkClass, type Column } from "@fit/ui";
import { withActorNames } from "../../../../../lib/actor-names.ts";
import { getDb, requirePagePermission } from "../../../../../lib/auth.ts";
import { requestRefundAction, revealEmailAction, revealNameAction } from "../../actions.ts";
import { formatPence, formatWhen, statusOf } from "../../format.ts";
import { paymentActions } from "../../record-actions.ts";
import { getPaymentView, listRefundsForPayment, loadRefundConfig, paymentHistory, type RefundView } from "../../refunds.ts";

const refundColumns: Column<RefundView>[] = [
  {
    key: "id",
    label: "Refund",
    render: (r) => (
      <Link className={linkClass} href={`/refunds/requests/${r.id}`}>
        {r.id.slice(0, 8)}
      </Link>
    ),
  },
  { key: "requestedAt", label: "Requested", render: (r) => formatWhen(r.requestedAt) },
  { key: "requestedBy", label: "By", render: (r) => r.requestedByName },
  { key: "amount", label: "Amount", render: (r) => formatPence(r.amountPence) },
  { key: "reason", label: "Reason", render: (r) => r.reason },
  { key: "status", label: "Status", render: (r) => <StatusBadge {...statusOf(r.status)} /> },
];

export default async function PaymentPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const user = await requirePagePermission("refunds:read", `/refunds/payments/${paymentId}`);
  const db = getDb();
  const payment = await getPaymentView(db, paymentId);
  if (!payment) notFound();
  const [refunds, history] = await Promise.all([listRefundsForPayment(db, payment.id), paymentHistory(db, payment.id).then((h) => withActorNames(db, h))]);
  const { approvalThresholdPence } = loadRefundConfig();
  const { actions, waiting } = paymentActions(user, payment);
  const canReveal = user.permissions.has("pii:unmask");
  const fullyRefunded = payment.refundedPence === payment.amountPence;
  const masked = (value: string, what: string, action: typeof revealNameAction) =>
    canReveal ? (
      <RevealButton what={what} masked={value} action={action} hidden={{ paymentId: payment.id }} minReasonLength={MIN_UNMASK_REASON_LENGTH} />
    ) : (
      value
    );

  return (
    <div className="stack">
      <RecordHeader
        back={{ href: "/refunds", label: "Payments" }}
        title={`${payment.reference} · ${formatPence(payment.amountPence)}`}
        status={fullyRefunded ? { label: "Fully refunded", kind: "done" } : { label: "Captured" }}
        owner={payment.merchant}
        ownerLabel="Merchant"
      />
      <ActionPanel
        label="Payment actions"
        waiting={waiting}
        note={actions.length ? `Refunds over ${formatPence(approvalThresholdPence)} need approval from a different approver.` : undefined}
      >
        {actions.includes("request") ? (
          <ActionDialog
            label="Request refund"
            variant="primary"
            description={`Up to ${formatPence(payment.availablePence)} can be refunded.`}
            action={requestRefundAction}
            hidden={{ paymentId: payment.id, refundId: randomUUID() }}
          >
            <Input id="amount" name="amount" label="Amount (£)" inputMode="decimal" required placeholder={`up to ${formatPence(payment.availablePence)}`} />
            <Input id="reason" name="reason" label="Reason" required maxLength={500} />
          </ActionDialog>
        ) : null}
      </ActionPanel>
      <RecordSection
        title="Details"
        fields={[
          { label: "Customer", value: masked(payment.customerName, "customer name", revealNameAction) },
          { label: "Customer email", value: masked(payment.customerEmail, "customer email", revealEmailAction) },
          { label: "Card", value: `${payment.cardBrand} •••• ${payment.cardLast4}` },
          { label: "Captured", value: formatWhen(payment.capturedAt) },
          { label: "Amount", value: formatPence(payment.amountPence) },
          { label: "Refunded", value: formatPence(payment.refundedPence) },
          { label: "Awaiting approval", value: formatPence(payment.pendingPence) },
          { label: "Refundable", value: formatPence(payment.availablePence) },
        ]}
      />
      <RecordSection title="Refunds">
        {refunds.length === 0 ? (
          <p className="text-sm text-muted-foreground">No refunds on this payment yet.</p>
        ) : (
          <Table caption="Refunds on this payment" columns={refundColumns} rows={refunds} rowKey={(r) => r.id} />
        )}
      </RecordSection>
      <RecordSection title="History">
        <Timeline
          items={history.map((h) => ({
            id: h.id,
            occurredAt: h.occurredAt,
            actor: h.actorName ?? "card system",
            actorTitle: h.actor,
            action: h.action,
            reason: h.reason,
          }))}
        />
      </RecordSection>
    </div>
  );
}
