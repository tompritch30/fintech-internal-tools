"use client";

import { useActionState } from "react";
import { Button, Input } from "@fit/ui";
import { approveRefundAction, rejectRefundAction, requestRefundAction, revealEmailAction, revealNameAction } from "./actions.ts";
import type { FormState } from "./format.ts";

const initial: FormState = {};
const formClass = "flex flex-wrap items-end gap-2";

function Feedback({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="w-full text-sm text-destructive">{state.error}</p>;
  if (state.message) return <p role="status" className="w-full text-sm text-muted-foreground">{state.message}</p>;
  return null;
}

/** `refundId` is minted when the page renders, so a double submit reuses it and refunds once. */
export function RefundRequestForm({ paymentId, refundId, maxPounds }: { paymentId: string; refundId: string; maxPounds: string }) {
  const [state, action, pending] = useActionState(requestRefundAction, initial);
  return (
    <form action={action} className={formClass} aria-label="Request a refund">
      <input type="hidden" name="paymentId" value={paymentId} />
      <input type="hidden" name="refundId" value={refundId} />
      <Input id="amount" name="amount" label="Amount (£)" inputMode="decimal" required placeholder={`up to ${maxPounds}`} />
      <Input id="reason" name="reason" label="Reason" required maxLength={500} className="w-72" />
      <Button type="submit" variant="primary" disabled={pending}>
        Request refund
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function DecisionForms({ refundId, version }: { refundId: string; version: number }) {
  const [approved, approve, approving] = useActionState(approveRefundAction, initial);
  const [rejected, reject, rejecting] = useActionState(rejectRefundAction, initial);
  const pending = approving || rejecting;
  return (
    <div className="flex w-full flex-col gap-3">
      <form action={approve} className={formClass} aria-label="Approve refund">
        <input type="hidden" name="refundId" value={refundId} />
        <input type="hidden" name="expectedVersion" value={version} />
        <Input id="approve-note" name="note" label="Approval note (optional)" maxLength={500} className="w-72" />
        <Button type="submit" variant="primary" disabled={pending}>
          Approve refund
        </Button>
        <Feedback state={approved} />
      </form>
      <form action={reject} className={formClass} aria-label="Reject refund">
        <input type="hidden" name="refundId" value={refundId} />
        <input type="hidden" name="expectedVersion" value={version} />
        <Input id="reject-note" name="note" label="Rejection reason" required maxLength={500} className="w-72" />
        <Button type="submit" variant="danger" disabled={pending}>
          Reject
        </Button>
        <Feedback state={rejected} />
      </form>
    </div>
  );
}

const REVEAL = {
  email: { action: revealEmailAction, label: "email" },
  name: { action: revealNameAction, label: "full name" },
} as const;

export function RevealField({ paymentId, field }: { paymentId: string; field: keyof typeof REVEAL }) {
  const { action: revealAction, label } = REVEAL[field];
  const [state, action, pending] = useActionState(revealAction, initial);
  return (
    <form action={action} className={formClass} aria-label={`Reveal customer ${label}`}>
      <input type="hidden" name="paymentId" value={paymentId} />
      <Input id={`reveal-${field}-reason`} name="reason" label={`Reason for revealing the ${label}`} required maxLength={500} className="w-72" />
      <Button type="submit" disabled={pending}>
        Reveal {label}
      </Button>
      {state.revealed ? (
        <p role="status" className="w-full text-sm">
          Customer {label}: <strong data-testid={`revealed-${field}`}>{state.revealed}</strong> (this read is audited)
        </p>
      ) : null}
      <Feedback state={state} />
    </form>
  );
}
