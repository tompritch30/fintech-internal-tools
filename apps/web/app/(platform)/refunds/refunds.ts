import { and, asc, count, desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  decideApproval,
  defineApprovalKind,
  listAuditForEntity,
  requestApproval,
  requirePermission,
  withAudit,
  type ActionContext,
  type AuditListItem,
} from "@fit/core";
import { defineMaskedEntity, mask, unmask } from "@fit/core/masking";
import { approvalRequests, payments, refunds, users, type Db, type Executor, type PaymentRow, type Tx } from "@fit/db";
import { issueProviderRefund, type ProviderRefund } from "./mock-provider.ts";

export interface RefundConfig {
  /** Refunds above this many pence need maker-checker approval. */
  approvalThresholdPence: number;
}

export const DEFAULT_APPROVAL_THRESHOLD_PENCE = 25_000;

export function loadRefundConfig(env: Record<string, string | undefined> = process.env): RefundConfig {
  const raw = env.REFUND_APPROVAL_THRESHOLD_PENCE?.trim();
  if (!raw) return { approvalThresholdPence: DEFAULT_APPROVAL_THRESHOLD_PENCE };
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(Number(raw))) {
    throw new Error(`REFUND_APPROVAL_THRESHOLD_PENCE must be a whole number of pence, got "${raw}"`);
  }
  return { approvalThresholdPence: Number(raw) };
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON = 500;

/** "12.34", "£1,200" or "12" → pence. Throws ValidationError on anything else. */
export function parsePounds(input: string): number {
  const raw = input.trim().replace(/^£/, "");
  // Commas only as thousands separators: "1,200" is fine, "1,20" is refused.
  if (!/^(\d{1,3}(,\d{3})+|\d+)(\.\d{1,2})?$/.test(raw)) throw new ValidationError("enter an amount in pounds, e.g. 12.50");
  const s = raw.replaceAll(",", "");
  const [whole = "0", frac = ""] = s.split(".");
  const pence = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (!Number.isSafeInteger(pence)) throw new ValidationError("amount is too large");
  return pence;
}

// ---------------------------------------------------------------------------
// Masking: the customer email and name are masked server-side for every reader.

const EMAIL_POLICY = { field: "customerEmail", style: "email", unmaskPermission: "pii:unmask" } as const;
const NAME_POLICY = { field: "customerName", style: "name", unmaskPermission: "pii:unmask" } as const;

const paymentEntity = defineMaskedEntity<PaymentRow>({
  entityType: "payment",
  policies: [EMAIL_POLICY, NAME_POLICY],
  load: async (tx, id) => (await tx.select().from(payments).where(eq(payments.id, id)))[0] ?? null,
});

export async function revealCustomerEmail(ctx: ActionContext, input: { paymentId: string; reason: string }): Promise<string | null> {
  if (!UUID.test(input.paymentId)) throw new NotFoundError(`payment ${input.paymentId} not found`);
  return unmask(ctx.db, ctx.user, paymentEntity, { entityId: input.paymentId, field: "customerEmail", reason: input.reason });
}

export async function revealCustomerName(ctx: ActionContext, input: { paymentId: string; reason: string }): Promise<string | null> {
  if (!UUID.test(input.paymentId)) throw new NotFoundError(`payment ${input.paymentId} not found`);
  return unmask(ctx.db, ctx.user, paymentEntity, { entityId: input.paymentId, field: "customerName", reason: input.reason });
}

// ---------------------------------------------------------------------------
// Reads

/** Refunds still waiting for a decision hold back their amount from what's refundable. */
// Qualified by hand: drizzle drops the table name in single-table selects, which is ambiguous here.
const pendingPence = sql<number>`coalesce((
  select sum(r.amount_pence) from refunds r
  join approval_requests a on a.id = r.approval_request_id
  where r.payment_id = "payments"."id" and r.status = 'pending' and a.status = 'pending'
), 0)::int`;

const listColumns = {
  id: payments.id,
  reference: payments.reference,
  customerName: payments.customerName,
  merchant: payments.merchant,
  cardBrand: payments.cardBrand,
  cardLast4: payments.cardLast4,
  amountPence: payments.amountPence,
  refundedPence: payments.refundedPence,
  pendingPence,
  capturedAt: payments.capturedAt,
};

const PAYMENT_SORTS = {
  reference: payments.reference,
  customerName: payments.customerName,
  merchant: payments.merchant,
  amountPence: payments.amountPence,
  capturedAt: payments.capturedAt,
  availablePence: sql`${payments.amountPence} - ${payments.refundedPence} - ${pendingPence}`,
} as const;

const MAX_SEARCH = 100;
const wholeIn = (n: number | undefined, min: number, max: number, fallback: number) =>
  n !== undefined && Number.isFinite(n) ? Math.min(Math.max(min, Math.trunc(n)), max) : fallback;

/** URL values are untrusted: clamp to whole numbers so the SQL offset is always valid. */
const page = (q: ListQueryInput) => {
  const pageSize = wholeIn(q.pageSize, 1, 1000, 20);
  return { pageSize, offset: (wholeIn(q.page, 1, Math.floor(Number.MAX_SAFE_INTEGER / pageSize), 1) - 1) * pageSize };
};

const searchTerm = (q: ListQueryInput) => q.search?.trim().slice(0, MAX_SEARCH) || undefined;

export async function searchPayments(db: Db, query: ListQueryInput): Promise<{ rows: PaymentListItem[]; total: number }> {
  const q = searchTerm(query);
  const where = q
    ? or(
        ilike(payments.reference, `%${q}%`),
        ilike(payments.customerName, `%${q}%`),
        ilike(payments.merchant, `%${q}%`),
        eq(payments.cardLast4, q),
      )
    : undefined;
  const sortCol = PAYMENT_SORTS[query.sort as keyof typeof PAYMENT_SORTS] ?? payments.capturedAt;
  const dir = query.dir === "asc" ? asc : desc;
  const { pageSize, offset } = page(query);
  const rows = await db.select(listColumns).from(payments).where(where).orderBy(dir(sortCol), asc(payments.id)).limit(pageSize).offset(offset);
  const [total] = await db.select({ n: count() }).from(payments).where(where);
  return {
    rows: rows.map(({ pendingPence, ...r }) => ({
      ...mask(r, [NAME_POLICY]),
      availablePence: r.amountPence - r.refundedPence - pendingPence,
    })),
    total: total?.n ?? 0,
  };
}

export async function getPaymentView(db: Db, id: string): Promise<PaymentView | null> {
  if (!UUID.test(id)) return null;
  const [row] = await db
    .select({ ...listColumns, customerEmail: payments.customerEmail })
    .from(payments)
    .where(eq(payments.id, id));
  if (!row) return null;
  const masked = mask(row, [EMAIL_POLICY, NAME_POLICY]);
  return { ...masked, availablePence: row.amountPence - row.refundedPence - row.pendingPence };
}

const requester = alias(users, "requester");
const decider = alias(users, "decider");

function refundViewQuery(db: Executor) {
  return db
    .select({
      refund: refunds,
      paymentReference: payments.reference,
      requesterName: sql<string>`coalesce(${requester.displayName}, ${requester.username})`,
      approval: {
        id: approvalRequests.id,
        status: approvalRequests.status,
        version: approvalRequests.version,
        decisionNote: approvalRequests.decisionNote,
      },
      deciderName: sql<string | null>`coalesce(${decider.displayName}, ${decider.username})`,
    })
    .from(refunds)
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .innerJoin(requester, eq(requester.id, refunds.requestedBy))
    .leftJoin(approvalRequests, eq(approvalRequests.id, refunds.approvalRequestId))
    .leftJoin(decider, eq(decider.id, approvalRequests.decidedBy))
    .$dynamic();
}

type RefundViewRow = Awaited<ReturnType<ReturnType<typeof refundViewQuery>["execute"]>>[number];

function toRefundView(row: RefundViewRow): RefundView {
  const { refund, approval } = row;
  let status: RefundDisplayStatus = "pending_approval";
  if (refund.status === "succeeded" || refund.status === "rejected") status = refund.status;
  // cancelApproval calls no hook, so a cancelled request still has a pending refund row.
  else if (approval?.status === "cancelled") status = "cancelled";
  return {
    id: refund.id,
    paymentId: refund.paymentId,
    paymentReference: row.paymentReference,
    amountPence: refund.amountPence,
    reason: refund.reason,
    status,
    requiresApproval: refund.requiresApproval,
    requestedBy: refund.requestedBy,
    requestedByName: row.requesterName,
    requestedAt: refund.requestedAt,
    providerRefundId: refund.providerRefundId,
    processedAt: refund.processedAt,
    approval: approval ? { ...approval, decidedByName: row.deciderName } : null,
  };
}

async function loadRefundView(db: Executor, id: string): Promise<RefundView | null> {
  if (!UUID.test(id)) return null;
  const [row] = await refundViewQuery(db).where(eq(refunds.id, id));
  return row ? toRefundView(row) : null;
}

export const getRefundView = (db: Db, id: string) => loadRefundView(db, id);

export async function listRefundsForPayment(db: Db, paymentId: string): Promise<RefundView[]> {
  if (!UUID.test(paymentId)) return [];
  const rows = await refundViewQuery(db).where(eq(refunds.paymentId, paymentId)).orderBy(desc(refunds.requestedAt));
  return rows.map(toRefundView);
}

export async function listPendingRefundApprovals(
  ctx: ActionContext,
  query: ListQueryInput,
): Promise<{ rows: PendingApprovalItem[]; total: number }> {
  await requirePermission({ db: ctx.db, user: ctx.user, resource: "refunds:approvals-queue" }, "refunds:approve");
  const q = searchTerm(query);
  const where = and(
    eq(approvalRequests.kind, refundApproval.kind),
    eq(approvalRequests.status, "pending"),
    q ? or(ilike(payments.reference, `%${q}%`), ilike(refunds.reason, `%${q}%`), ilike(requester.username, `%${q}%`)) : undefined,
  );
  const sorts = { amountPence: refunds.amountPence, requestedAt: refunds.requestedAt, paymentReference: payments.reference } as const;
  const sortCol = sorts[query.sort as keyof typeof sorts] ?? refunds.requestedAt;
  const dir = query.dir === "desc" ? desc : asc;
  const { pageSize, offset } = page(query);
  const base = () =>
    ctx.db
      .select({
        refundId: refunds.id,
        paymentReference: payments.reference,
        amountPence: refunds.amountPence,
        reason: refunds.reason,
        requestedBy: refunds.requestedBy,
        requestedByName: sql<string>`coalesce(${requester.displayName}, ${requester.username})`,
        requestedAt: refunds.requestedAt,
      })
      .from(refunds)
      .innerJoin(approvalRequests, eq(approvalRequests.id, refunds.approvalRequestId))
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .innerJoin(requester, eq(requester.id, refunds.requestedBy))
      .where(where);
  const rows = await base().orderBy(dir(sortCol), asc(refunds.id)).limit(pageSize).offset(offset);
  const [total] = await ctx.db
    .select({ n: count() })
    .from(refunds)
    .innerJoin(approvalRequests, eq(approvalRequests.id, refunds.approvalRequestId))
    .innerJoin(payments, eq(payments.id, refunds.paymentId))
    .innerJoin(requester, eq(requester.id, refunds.requestedBy))
    .where(where);
  return { rows, total: total?.n ?? 0 };
}

/** Audit history of a refund and its approval request, newest first (feeds Timeline). */
export async function refundHistory(db: Db, refundId: string): Promise<AuditListItem[]> {
  const refund = UUID.test(refundId) ? (await db.select().from(refunds).where(eq(refunds.id, refundId)))[0] : undefined;
  if (!refund) return [];
  const own = await listAuditForEntity(db, "refund", refund.id);
  const approval = refund.approvalRequestId ? await listAuditForEntity(db, "approval_request", refund.approvalRequestId) : [];
  return [...own, ...approval].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id - a.id);
}

/** Audit history of a payment (its capture, then any reveals), newest first. */
export async function paymentHistory(db: Db, paymentId: string): Promise<AuditListItem[]> {
  if (!UUID.test(paymentId)) return [];
  return listAuditForEntity(db, "payment", paymentId);
}

// ---------------------------------------------------------------------------
// Writes

interface RefundPayload {
  paymentId: string;
  amountPence: number;
}

/** Thrown inside a transaction to roll it back when the same refund id was already submitted. */
class AlreadySubmitted extends Error {}
class DirectRefundThresholdExceeded extends Error {}

const actorRef = (ctx: ActionContext) => ({ id: ctx.user.id, subject: ctx.user.subject });

function validateRequest(input: RefundRequestInput): RefundRequestInput {
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!UUID.test(String(input.refundId))) throw new ValidationError("invalid refund id");
  if (!UUID.test(String(input.paymentId))) throw new NotFoundError(`payment ${input.paymentId} not found`);
  if (!Number.isSafeInteger(input.amountPence) || input.amountPence <= 0) {
    throw new ValidationError("refund amount must be a positive whole number of pence");
  }
  if (!reason) throw new ValidationError("a refund needs a reason");
  if (reason.length > MAX_REASON) throw new ValidationError(`reason must be at most ${MAX_REASON} characters`);
  return { ...input, reason };
}

/** Returns the existing refund for a resubmitted id, or throws if the id was used for something else. */
async function findResubmission(db: Executor, ctx: ActionContext, input: RefundRequestInput): Promise<RefundView | null> {
  const existing = await loadRefundView(db, input.refundId);
  if (!existing) return null;
  const same =
    existing.paymentId === input.paymentId &&
    existing.amountPence === input.amountPence &&
    existing.reason === input.reason &&
    existing.requestedBy === ctx.user.id;
  if (!same) throw new ConflictError(`refund ${input.refundId} was already submitted with different details`);
  return existing;
}

/** Locks the payment row so concurrent refunds on it are checked one at a time. */
async function lockPayment(tx: Tx, paymentId: string): Promise<PaymentRow> {
  const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for("update");
  if (!payment) throw new NotFoundError(`payment ${paymentId} not found`);
  return payment;
}

async function insertRefund(
  tx: Tx,
  ctx: ActionContext,
  input: RefundRequestInput,
  approvalRequestId: string | null,
): Promise<void> {
  const payment = await lockPayment(tx, input.paymentId);
  if (await findResubmission(tx, ctx, input)) throw new AlreadySubmitted();
  const [held] = await tx
    .select({ v: sql<number>`coalesce(sum(${refunds.amountPence}), 0)::int` })
    .from(refunds)
    .innerJoin(approvalRequests, eq(approvalRequests.id, refunds.approvalRequestId))
    .where(and(eq(refunds.paymentId, payment.id), eq(refunds.status, "pending"), eq(approvalRequests.status, "pending")));
  const available = payment.amountPence - payment.refundedPence - (held?.v ?? 0);
  if (input.amountPence > available) {
    throw new ValidationError(`refund exceeds the £${(available / 100).toFixed(2)} still refundable on ${payment.reference}`);
  }
  await withAudit(
    tx,
    {
      actor: actorRef(ctx),
      action: "refund.requested",
      entityType: "refund",
      entityId: input.refundId,
      reason: input.reason,
      after: { paymentId: payment.id, amountPence: input.amountPence, requiresApproval: approvalRequestId !== null },
    },
    async (t) => {
      await t.insert(refunds).values({
        id: input.refundId,
        paymentId: payment.id,
        amountPence: input.amountPence,
        reason: input.reason,
        requiresApproval: approvalRequestId !== null,
        approvalRequestId,
        requestedBy: ctx.user.id,
      });
    },
  );
}

/** Moves the money: the only place the provider is called. Exactly once per refund. */
async function executeRefund(tx: Tx, ctx: ActionContext, refundId: string): Promise<void> {
  const [refund] = await tx.select().from(refunds).where(eq(refunds.id, refundId));
  if (!refund) throw new NotFoundError(`refund ${refundId} not found`);
  const payment = await lockPayment(tx, refund.paymentId);
  if (refund.status !== "pending") throw new ConflictError(`refund ${refundId} is already ${refund.status}`);
  if (payment.refundedPence + refund.amountPence > payment.amountPence) {
    throw new ConflictError(`refund ${refundId} would exceed the payment amount`);
  }
  await withAudit<ProviderRefund>(
    tx,
    (provider) => ({
      actor: actorRef(ctx),
      action: "refund.succeeded",
      entityType: "refund",
      entityId: refund.id,
      before: { status: "pending" },
      after: { status: "succeeded", providerRefundId: provider.id, amountPence: refund.amountPence },
    }),
    async (t) => {
      const provider = await issueProviderRefund(t, {
        refundId: refund.id,
        paymentReference: payment.reference,
        amountPence: refund.amountPence,
      });
      await t
        .update(refunds)
        .set({ status: "succeeded", providerRefundId: provider.id, processedAt: sql`now()` })
        .where(and(eq(refunds.id, refund.id), eq(refunds.status, "pending")));
      await t
        .update(payments)
        .set({ refundedPence: sql`${payments.refundedPence} + ${refund.amountPence}` })
        .where(eq(payments.id, payment.id));
      return provider;
    },
  );
}

/** Rejection's effect, run by onRejected inside the decision's transaction. */
async function markRejected(tx: Tx, ctx: ActionContext, refundId: string): Promise<void> {
  await withAudit(
    tx,
    {
      actor: actorRef(ctx),
      action: "refund.rejected",
      entityType: "refund",
      entityId: refundId,
      before: { status: "pending" },
      after: { status: "rejected" },
    },
    async (t) => {
      const updated = await t
        .update(refunds)
        .set({ status: "rejected" })
        .where(and(eq(refunds.id, refundId), eq(refunds.status, "pending")))
        .returning({ id: refunds.id });
      if (updated.length !== 1) throw new ConflictError(`refund ${refundId} is no longer pending`);
    },
  );
}

/** Core calls the hooks with (tx, request) only, so each call builds its kind with the actor in scope. */
export const refundApproval = defineApprovalKind<RefundPayload>({
  kind: "refund.issue",
  subjectType: "refund",
  requestPermission: "refunds:request",
  approvePermission: "refunds:approve",
});

export async function requestRefund(
  ctx: ActionContext,
  rawInput: RefundRequestInput,
  config: RefundConfig = loadRefundConfig(),
): Promise<RefundView> {
  await requirePermission({ db: ctx.db, user: ctx.user, resource: "refunds:request" }, "refunds:request");
  const input = validateRequest(rawInput);
  const resubmitted = await findResubmission(ctx.db, ctx, input);
  if (resubmitted) return resubmitted;

  try {
    if (input.amountPence > config.approvalThresholdPence) {
      await requestApproval(ctx.db, ctx.user, {
        ...refundApproval,
        onRequested: (tx, request) => insertRefund(tx, ctx, input, request.id),
      }, { subjectId: input.refundId, payload: { paymentId: input.paymentId, amountPence: input.amountPence } });
    } else {
      try {
        await ctx.db.transaction(async (tx) => {
          const payment = await lockPayment(tx, input.paymentId);
          const [direct] = await tx
            .select({ amount: sql<number>`coalesce(sum(${refunds.amountPence}), 0)::int` })
            .from(refunds)
            .where(
              and(
                eq(refunds.paymentId, payment.id),
                eq(refunds.requiresApproval, false),
                inArray(refunds.status, ["pending", "succeeded"]),
              ),
            );
          if ((direct?.amount ?? 0) + input.amountPence > config.approvalThresholdPence) {
            throw new DirectRefundThresholdExceeded();
          }
          await insertRefund(tx, ctx, input, null);
          await executeRefund(tx, ctx, input.refundId);
        });
      } catch (err) {
        if (!(err instanceof DirectRefundThresholdExceeded)) throw err;
        await requestApproval(
          ctx.db,
          ctx.user,
          {
            ...refundApproval,
            onRequested: (tx, request) => insertRefund(tx, ctx, input, request.id),
          },
          { subjectId: input.refundId, payload: { paymentId: input.paymentId, amountPence: input.amountPence } },
        );
      }
    }
  } catch (err) {
    if (!(err instanceof AlreadySubmitted)) throw err;
  }
  const view = await loadRefundView(ctx.db, input.refundId);
  if (!view) throw new Error(`refund ${input.refundId} missing after request`);
  return view;
}

async function decide(
  ctx: ActionContext,
  input: { refundId: string; expectedVersion: number; note?: string },
  decision: "approve" | "reject",
): Promise<RefundView> {
  const refund = await loadRefundView(ctx.db, input.refundId);
  if (!refund) throw new NotFoundError(`refund ${input.refundId} not found`);
  if (!refund.approval) throw new ConflictError(`refund ${refund.id} did not need approval`);
  const kind = {
    ...refundApproval,
    onApproved: (tx: Tx, request: { subjectId: string }) => executeRefund(tx, ctx, request.subjectId),
    onRejected: (tx: Tx, request: { subjectId: string }) => markRejected(tx, ctx, request.subjectId),
  };
  await decideApproval(ctx.db, ctx.user, kind, {
    id: refund.approval.id,
    decision,
    note: input.note,
    expectedVersion: input.expectedVersion,
  });
  const view = await loadRefundView(ctx.db, refund.id);
  if (!view) throw new Error(`refund ${refund.id} missing after decision`);
  return view;
}

export const approveRefund = (ctx: ActionContext, input: { refundId: string; expectedVersion: number; note?: string }) =>
  decide(ctx, input, "approve");

export const rejectRefund = (ctx: ActionContext, input: { refundId: string; expectedVersion: number; note: string }) =>
  decide(ctx, input, "reject");
