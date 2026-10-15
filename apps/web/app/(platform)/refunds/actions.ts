"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ConflictError, ForbiddenError, NotFoundError, SelfApprovalError, ValidationError } from "@fit/core";
import { defineAction } from "../../../lib/auth.ts";
import type { FormState } from "./format.ts";
import { approveRefund, parsePounds, rejectRefund, requestRefund, revealCustomerEmail } from "./refunds.ts";

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** Expected errors become form messages; anything else is a bug and goes to the error boundary. */
function failure(err: unknown): FormState {
  if (err instanceof SelfApprovalError) return { error: "You requested this refund, so a different approver must decide it." };
  if (err instanceof ForbiddenError) return { error: "You don't have permission to do that." };
  if (err instanceof ConflictError) return { error: "This refund has already been decided or changed. Reload the page." };
  if (err instanceof ValidationError || err instanceof NotFoundError) return { error: err.message };
  throw err;
}

export const requestRefundAction = defineAction(
  "approvals:request",
  "refunds.request",
  async (ctx, _prev: FormState, form: FormData): Promise<FormState> => {
    let target: string;
    try {
      const refund = await requestRefund(ctx, {
        refundId: field(form, "refundId"),
        paymentId: field(form, "paymentId"),
        amountPence: parsePounds(field(form, "amount")),
        reason: field(form, "reason"),
      });
      target = refund.id;
      revalidatePath(`/refunds/payments/${refund.paymentId}`);
    } catch (err) {
      return failure(err);
    }
    redirect(`/refunds/requests/${target}`);
  },
);

export const approveRefundAction = defineAction(
  "approvals:decide",
  "refunds.approve",
  async (ctx, _prev: FormState, form: FormData): Promise<FormState> => {
    const refundId = field(form, "refundId");
    try {
      await approveRefund(ctx, { refundId, expectedVersion: Number(field(form, "expectedVersion")), note: field(form, "note") });
    } catch (err) {
      return failure(err);
    }
    revalidatePath(`/refunds/requests/${refundId}`);
    return { message: "Approved. The refund was sent to the payment provider." };
  },
);

export const rejectRefundAction = defineAction(
  "approvals:decide",
  "refunds.reject",
  async (ctx, _prev: FormState, form: FormData): Promise<FormState> => {
    const refundId = field(form, "refundId");
    try {
      await rejectRefund(ctx, { refundId, expectedVersion: Number(field(form, "expectedVersion")), note: field(form, "note") });
    } catch (err) {
      return failure(err);
    }
    revalidatePath(`/refunds/requests/${refundId}`);
    return { message: "Rejected. No money was moved." };
  },
);

export const revealEmailAction = defineAction(
  "pii:unmask",
  "refunds.revealEmail",
  async (ctx, _prev: FormState, form: FormData): Promise<FormState> => {
    try {
      const email = await revealCustomerEmail(ctx, { paymentId: field(form, "paymentId"), reason: field(form, "reason") });
      return { email: email ?? "" };
    } catch (err) {
      return failure(err);
    }
  },
);
