import type { ActionContext, AuditListItem } from "@fit/core";
import type { Db } from "@fit/db";

// Stub: the API the rule tests are written against. Implementation follows in the next commit.
const notImplemented = (): never => {
  throw new Error("not implemented");
};

export interface RefundConfig {
  /** Refunds above this many pence need maker-checker approval. */
  approvalThresholdPence: number;
}

export const DEFAULT_APPROVAL_THRESHOLD_PENCE = 25_000;

export function loadRefundConfig(_env: Record<string, string | undefined> = process.env): RefundConfig {
  return notImplemented();
}

export type RefundDisplayStatus = "pending_approval" | "succeeded" | "rejected" | "cancelled";

export interface PaymentListItem {
  id: string;
  reference: string;
  customerName: string;
  merchant: string;
  cardBrand: string;
  cardLast4: string;
  amountPence: number;
  refundedPence: number;
  /** Amount still refundable: original minus succeeded and pending-approval refunds. */
  availablePence: number;
  capturedAt: Date;
}

export interface PaymentView extends PaymentListItem {
  /** Always masked (e.g. "o•••@example.test"). */
  customerEmail: string;
  pendingPence: number;
}

export interface RefundView {
  id: string;
  paymentId: string;
  paymentReference: string;
  amountPence: number;
  reason: string;
  status: RefundDisplayStatus;
  requiresApproval: boolean;
  requestedBy: string;
  requestedByName: string;
  requestedAt: Date;
  providerRefundId: string | null;
  processedAt: Date | null;
  approval: {
    id: string;
    status: "pending" | "approved" | "rejected" | "cancelled";
    version: number;
    decidedByName: string | null;
    decisionNote: string | null;
  } | null;
}

export interface PendingApprovalItem {
  refundId: string;
  paymentReference: string;
  amountPence: number;
  reason: string;
  requestedBy: string;
  requestedByName: string;
  requestedAt: Date;
}

export interface ListQueryInput {
  search?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

export interface RefundRequestInput {
  /** Generated when the form is rendered; the idempotency key for this refund. */
  refundId: string;
  paymentId: string;
  amountPence: number;
  reason: string;
}

/** "12.34" or "12" → 1234 pence. Throws ValidationError on anything else. */
export function parsePounds(_input: string): number {
  return notImplemented();
}

export async function requestRefund(_ctx: ActionContext, _input: RefundRequestInput, _config?: RefundConfig): Promise<RefundView> {
  return notImplemented();
}

export async function approveRefund(_ctx: ActionContext, _input: { refundId: string; expectedVersion: number; note?: string }): Promise<RefundView> {
  return notImplemented();
}

export async function rejectRefund(_ctx: ActionContext, _input: { refundId: string; expectedVersion: number; note: string }): Promise<RefundView> {
  return notImplemented();
}

export async function revealCustomerEmail(_ctx: ActionContext, _input: { paymentId: string; reason: string }): Promise<string | null> {
  return notImplemented();
}

export async function searchPayments(_db: Db, _query: ListQueryInput): Promise<{ rows: PaymentListItem[]; total: number }> {
  return notImplemented();
}

export async function getPaymentView(_db: Db, _id: string): Promise<PaymentView | null> {
  return notImplemented();
}

export async function getRefundView(_db: Db, _id: string): Promise<RefundView | null> {
  return notImplemented();
}

export async function listRefundsForPayment(_db: Db, _paymentId: string): Promise<RefundView[]> {
  return notImplemented();
}

export async function listPendingRefundApprovals(_ctx: ActionContext, _query: ListQueryInput): Promise<{ rows: PendingApprovalItem[]; total: number }> {
  return notImplemented();
}

/** Audit history of a refund and its approval request, newest first (feeds Timeline). */
export async function refundHistory(_db: Db, _refundId: string): Promise<AuditListItem[]> {
  return notImplemented();
}
