import { randomUUID } from "node:crypto";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, CommandBar, RecordHeader, Table, type Column } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../../../lib/auth.ts";
import { RefundRequestForm, RevealField } from "../../forms.tsx";
import { formatPence, formatWhen, STATUS } from "../../format.ts";
import type { AuditListItem } from "@fit/core";
import { getPaymentView, listRefundsForPayment, loadRefundConfig, paymentHistory, type RefundView } from "../../refunds.ts";

const refundColumns: Column<RefundView>[] = [
  {
    key: "id",
    label: "Refund",
    render: (r) => (
      <Link className="font-medium underline-offset-4 hover:underline" href={`/refunds/requests/${r.id}`}>
        {r.id.slice(0, 8)}
      </Link>
    ),
  },
  { key: "requestedAt", label: "Requested", render: (r) => formatWhen(r.requestedAt) },
  { key: "requestedBy", label: "By", render: (r) => r.requestedByName },
  { key: "amount", label: "Amount", render: (r) => formatPence(r.amountPence) },
  { key: "reason", label: "Reason", render: (r) => r.reason },
  { key: "status", label: "Status", render: (r) => <Badge tone={STATUS[r.status]?.tone}>{STATUS[r.status]?.label}</Badge> },
];

const historyColumns: Column<AuditListItem>[] = [
  { key: "occurredAt", label: "When", render: (h) => formatWhen(h.occurredAt) },
  { key: "actor", label: "Who", render: (h) => h.actor ?? "system" },
  { key: "action", label: "Action", render: (h) => h.action },
  { key: "reason", label: "Reason", render: (h) => h.reason ?? "" },
];

export default async function PaymentPage({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const user = await requirePagePermission("refunds:read", `/refunds/payments/${paymentId}`);
  const db = getDb();
  const payment = await getPaymentView(db, paymentId);
  if (!payment) notFound();
  const [refunds, history] = await Promise.all([listRefundsForPayment(db, payment.id), paymentHistory(db, payment.id)]);
  const { approvalThresholdPence } = loadRefundConfig();
  const canRequest = user.permissions.has("refunds:request") && payment.availablePence > 0;
  const canReveal = user.permissions.has("pii:unmask");
  const fullyRefunded = payment.refundedPence === payment.amountPence;

  return (
    <div className="stack">
      <RecordHeader
        title={`${payment.reference} · ${payment.merchant}`}
        status={fullyRefunded ? { label: "Fully refunded", tone: "neutral" } : { label: "Captured", tone: "info" }}
        owner={payment.customerName}
        fields={[
          { label: "Customer email", value: payment.customerEmail },
          { label: "Card", value: `${payment.cardBrand} •••• ${payment.cardLast4}` },
          { label: "Captured", value: formatWhen(payment.capturedAt) },
          { label: "Amount", value: formatPence(payment.amountPence) },
          { label: "Refunded", value: formatPence(payment.refundedPence) },
          { label: "Awaiting approval", value: formatPence(payment.pendingPence) },
          { label: "Refundable", value: formatPence(payment.availablePence) },
        ]}
      />
      {canRequest || canReveal ? (
        <CommandBar label="Payment actions">
          <div className="flex w-full flex-col gap-3">
            {canRequest ? (
              <>
                <RefundRequestForm paymentId={payment.id} refundId={randomUUID()} maxPounds={formatPence(payment.availablePence)} />
                <p className="text-xs text-muted-foreground">
                  Refunds over {formatPence(approvalThresholdPence)} need approval from a different approver.
                </p>
              </>
            ) : null}
            {canReveal ? (
              <>
                <RevealField paymentId={payment.id} field="name" />
                <RevealField paymentId={payment.id} field="email" />
              </>
            ) : null}
          </div>
        </CommandBar>
      ) : null}
      <h2>Refunds</h2>
      {refunds.length === 0 ? (
        <p>No refunds on this payment yet.</p>
      ) : (
        <Table caption="Refunds on this payment" columns={refundColumns} rows={refunds} rowKey={(r) => r.id} />
      )}
      <h2>History</h2>
      {history.length === 0 ? (
        <p>No history recorded for this payment.</p>
      ) : (
        <Table caption="Payment history" columns={historyColumns} rows={history} rowKey={(h) => String(h.id)} />
      )}
    </div>
  );
}
