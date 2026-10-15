import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, SelfApprovalError, ValidationError, permissionsFor } from "@fit/core";
import { approvalRequests, auditLog, createDb, mockProviderRefunds, payments, refunds } from "@fit/db";
import { seedPayments } from "@fit/db/seed";
import { expectDbError, makeUser, ownerDb } from "../../../packages/core/test/helpers/db.ts";
import { TEST_DATABASE_URL } from "../../../packages/core/test/helpers/env.ts";
import {
  approveRefund,
  getPaymentView,
  listPendingRefundApprovals,
  parsePounds,
  loadRefundConfig,
  refundHistory,
  rejectRefund,
  requestRefund,
  revealCustomerEmail,
  revealCustomerName,
  searchPayments,
} from "../app/(platform)/refunds/refunds.ts";

// app_runtime with enough connections for the concurrency tests.
const db = createDb(TEST_DATABASE_URL, { max: 6 });
afterAll(() => db.$client.end());
const owner = ownerDb();

const config = { approvalThresholdPence: 25_000 };

const analyst = async () => ({ db, user: (await makeUser(db, ["analyst"])).user });
const approver = async () => ({ db, user: (await makeUser(db, ["approver"])).user });

/** Payments are created by the seed role only (app_runtime can't insert them). */
async function newPayment(amountPence: number) {
  const n = randomUUID().slice(0, 8);
  const [row] = await owner
    .insert(payments)
    .values({
      reference: `PAY-T-${n}`,
      customerName: `Test Customer${n}`,
      customerEmail: `test.customer.${n}@example.test`,
      merchant: "Test Merchant",
      cardBrand: "Visa",
      cardLast4: "4242",
      amountPence,
      capturedAt: new Date(),
    })
    .returning();
  if (!row) throw new Error("payment insert failed");
  return row;
}

const refundInput = (paymentId: string, amountPence: number, reason = "Customer returned the item") => ({
  refundId: randomUUID(),
  paymentId,
  amountPence,
  reason,
});

const providerRows = (refundId: string) => db.select().from(mockProviderRefunds).where(eq(mockProviderRefunds.refundId, refundId));
const refundRows = (paymentId: string) => db.select().from(refunds).where(eq(refunds.paymentId, paymentId));
const refundedPence = async (paymentId: string) =>
  (await db.select({ v: payments.refundedPence }).from(payments).where(eq(payments.id, paymentId)))[0]?.v;
const auditFor = (entityId: string, action?: string) =>
  db
    .select()
    .from(auditLog)
    .where(action ? and(eq(auditLog.entityId, entityId), eq(auditLog.action, action)) : eq(auditLog.entityId, entityId));

async function pendingRefund(amountPence = 30_000) {
  const payment = await newPayment(100_000);
  const maker = await analyst();
  const refund = await requestRefund(maker, refundInput(payment.id, amountPence), config);
  return { payment, maker, refund };
}

describe("refunds permissions come from the registry", () => {
  it("analysts request, approvers approve, both read; admins get none", () => {
    expect([...permissionsFor(["analyst"])]).toEqual(expect.arrayContaining(["refunds:read", "refunds:request"]));
    expect([...permissionsFor(["approver"])]).toEqual(expect.arrayContaining(["refunds:read", "refunds:approve"]));
    expect(permissionsFor(["analyst"]).has("refunds:approve" as never)).toBe(false);
    expect(permissionsFor(["approver"]).has("refunds:request" as never)).toBe(false);
    expect([...permissionsFor(["admin"])].filter((p) => p.startsWith("refunds:"))).toEqual([]);
  });
});

describe("rule 1: an analyst finds a payment and requests a refund with a reason", () => {
  it("finds a payment by its reference, without the customer email in the list", async () => {
    const payment = await newPayment(5_000);
    const { rows } = await searchPayments(db, { search: payment.reference });
    expect(rows.map((r) => r.id)).toEqual([payment.id]);
    expect(JSON.stringify(rows)).not.toContain(payment.customerEmail);
  });

  it("rejects a refund request without a reason and writes nothing", async () => {
    const payment = await newPayment(5_000);
    const input = refundInput(payment.id, 1_000, "   ");
    await expect(requestRefund(await analyst(), input, config)).rejects.toBeInstanceOf(ValidationError);
    expect(await refundRows(payment.id)).toHaveLength(0);
    expect(await auditFor(input.refundId)).toHaveLength(0);
  });

  it("accepts the same request with a reason and audits it (positive control)", async () => {
    const payment = await newPayment(5_000);
    const input = refundInput(payment.id, 1_000, "Duplicate charge");
    const refund = await requestRefund(await analyst(), input, config);
    expect(refund).toMatchObject({ id: input.refundId, amountPence: 1_000, reason: "Duplicate charge" });
    const [requested] = await auditFor(input.refundId, "refund.requested");
    expect(requested).toMatchObject({ entityType: "refund", reason: "Duplicate charge" });
  });

  it("rejects a refund above the unrefunded amount", async () => {
    const payment = await newPayment(5_000);
    await expect(requestRefund(await analyst(), refundInput(payment.id, 5_001), config)).rejects.toBeInstanceOf(ValidationError);
    expect(await refundRows(payment.id)).toHaveLength(0);
  });

  it("accepts exactly the unrefunded amount (positive control)", async () => {
    const payment = await newPayment(5_000);
    const refund = await requestRefund(await analyst(), refundInput(payment.id, 5_000), config);
    expect(refund.status).toBe("succeeded");
    expect(await refundedPence(payment.id)).toBe(5_000);
  });

  it("rejects zero, negative and fractional amounts", async () => {
    const payment = await newPayment(5_000);
    const maker = await analyst();
    for (const amount of [0, -100, 10.5]) {
      await expect(requestRefund(maker, refundInput(payment.id, amount), config)).rejects.toBeInstanceOf(ValidationError);
    }
    expect(await refundRows(payment.id)).toHaveLength(0);
  });

  it("refuses a misplaced comma in the amount instead of guessing", () => {
    for (const bad of ["1,20", "12,0", ",120", "1,2000", "1,,200"]) expect(() => parsePounds(bad)).toThrow(ValidationError);
  });

  it("reads thousands separators and pence correctly (positive control)", () => {
    expect(parsePounds("£1,200.50")).toBe(120_050);
    expect(parsePounds("1,234,567")).toBe(123_456_700);
    expect(parsePounds("250.01")).toBe(25_001);
  });

  it("serves a valid page for malformed page numbers and over-long searches", async () => {
    const payment = await newPayment(5_000);
    expect(await searchPayments(db, { page: 10_001, pageSize: 5 })).toMatchObject({ rows: [] });
    for (const p of [1.01, Number.POSITIVE_INFINITY, Number.NaN, -3]) {
      await expect(searchPayments(db, { page: p, pageSize: 5 })).resolves.toMatchObject({ rows: expect.any(Array) });
    }
    const { rows } = await searchPayments(db, { search: payment.reference + "x".repeat(10_000) });
    expect(rows).toEqual([]);
    const control = await searchPayments(db, { search: payment.reference, page: 1 });
    expect(control.rows.map((r) => r.id)).toEqual([payment.id]);
  });

  it("denies a user without refunds:request and audits the denial", async () => {
    const payment = await newPayment(5_000);
    const { user } = await makeUser(db, []);
    await expect(requestRefund({ db, user }, refundInput(payment.id, 1_000), config)).rejects.toBeInstanceOf(ForbiddenError);
    const denials = await db.select().from(auditLog).where(and(eq(auditLog.actorUserId, user.id), eq(auditLog.action, "access.denied")));
    expect(denials).toHaveLength(1);
    expect(await refundRows(payment.id)).toHaveLength(0);
  });
});

describe("rule 2: refunds over the threshold need a different approver", () => {
  it("holds a refund over £250 for approval and moves no money", async () => {
    const { payment, refund } = await pendingRefund(25_001);
    expect(refund.status).toBe("pending_approval");
    expect(refund.approval).toMatchObject({ status: "pending" });
    expect(await providerRows(refund.id)).toHaveLength(0);
    expect(await refundedPence(payment.id)).toBe(0);
  });

  it("sends a refund of £250 or less straight through, still audited (positive control)", async () => {
    const payment = await newPayment(100_000);
    const refund = await requestRefund(await analyst(), refundInput(payment.id, 25_000), config);
    expect(refund.status).toBe("succeeded");
    expect(refund.approval).toBeNull();
    expect(await providerRows(refund.id)).toHaveLength(1);
    expect((await auditFor(refund.id)).map((r) => r.action).sort()).toEqual(["refund.requested", "refund.succeeded"]);
  });

  it("takes the threshold from config", async () => {
    const payment = await newPayment(100_000);
    const maker = await analyst();
    const strict = await requestRefund(maker, refundInput(payment.id, 6_000), { approvalThresholdPence: 5_000 });
    expect(strict.status).toBe("pending_approval");
    const normal = await requestRefund(maker, refundInput(payment.id, 6_000), config);
    expect(normal.status).toBe("succeeded");
  });

  it("reads REFUND_APPROVAL_THRESHOLD_PENCE, defaults to 25000, and rejects bad values", () => {
    expect(loadRefundConfig({}).approvalThresholdPence).toBe(25_000);
    expect(loadRefundConfig({ REFUND_APPROVAL_THRESHOLD_PENCE: "10000" }).approvalThresholdPence).toBe(10_000);
    expect(() => loadRefundConfig({ REFUND_APPROVAL_THRESHOLD_PENCE: "abc" })).toThrow();
    expect(() => loadRefundConfig({ REFUND_APPROVAL_THRESHOLD_PENCE: "-1" })).toThrow();
  });

  it("rejects approval when the approver is the requester", async () => {
    const payment = await newPayment(100_000);
    const both = { db, user: (await makeUser(db, ["analyst", "approver"])).user };
    const refund = await requestRefund(both, refundInput(payment.id, 30_000), config);
    await expect(approveRefund(both, { refundId: refund.id, expectedVersion: 1 })).rejects.toBeInstanceOf(SelfApprovalError);
    expect(await providerRows(refund.id)).toHaveLength(0);

    // Positive control: a different approver can approve the same refund.
    const approved = await approveRefund(await approver(), { refundId: refund.id, expectedVersion: 1 });
    expect(approved.status).toBe("succeeded");
  });

  it("rejects approval by a user without approver rights", async () => {
    const { refund } = await pendingRefund();
    await expect(approveRefund(await analyst(), { refundId: refund.id, expectedVersion: 1 })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await providerRows(refund.id)).toHaveLength(0);
    // Positive control: an approver can.
    expect((await approveRefund(await approver(), { refundId: refund.id, expectedVersion: 1 })).status).toBe("succeeded");
  });
});

describe("rule 3: card numbers are never stored; the email is masked", () => {
  it("payments store only the card's last four digits", async () => {
    const cols = await db.execute<{ column_name: string }>(
      sql`select column_name from information_schema.columns where table_name = 'payments'`,
    );
    const names = cols.rows.map((c) => c.column_name);
    expect(names).toContain("card_last4");
    expect(names.filter((n) => /card_number|pan|cvv|cvc|expiry/.test(n))).toEqual([]);

    const base = { customerName: "X", customerEmail: "x@example.test", merchant: "M", cardBrand: "Visa", amountPence: 100, capturedAt: new Date() };
    await expectDbError(
      owner.insert(payments).values({ ...base, reference: `PAY-T-${randomUUID()}`, cardLast4: "4111111111111111" }),
      /payments_card_last4_only/,
    );
    // Positive control: four digits are accepted.
    await owner.insert(payments).values({ ...base, reference: `PAY-T-${randomUUID()}`, cardLast4: "1111" });
  });

  it("seeded payments contain no card numbers", () => {
    const seeded = seedPayments();
    expect(seeded.length).toBeGreaterThan(20);
    for (const p of seeded) {
      expect(p.cardLast4).toMatch(/^\d{4}$/);
      expect(JSON.stringify(p)).not.toMatch(/\d{12,}/);
    }
  });

  it("the payment view masks the customer email", async () => {
    const payment = await newPayment(5_000);
    const view = await getPaymentView(db, payment.id);
    expect(view?.customerEmail).toBe("t•••@example.test");
    expect(JSON.stringify(view)).not.toContain(payment.customerEmail);
  });

  it("revealing the email needs a reason", async () => {
    const payment = await newPayment(5_000);
    const checker = await approver();
    await expect(revealCustomerEmail(checker, { paymentId: payment.id, reason: "  " })).rejects.toBeInstanceOf(ValidationError);
    expect(await auditFor(payment.id, "field.unmask")).toHaveLength(0);

    // Positive control: with a reason the raw email comes back and the read is audited (without the value).
    const email = await revealCustomerEmail(checker, { paymentId: payment.id, reason: "Confirming refund with customer" });
    expect(email).toBe(payment.customerEmail);
    const [row] = await auditFor(payment.id, "field.unmask");
    expect(row).toMatchObject({ entityType: "payment", reason: "Confirming refund with customer", actorUserId: checker.user.id });
    expect(JSON.stringify(row)).not.toContain(payment.customerEmail);
  });

  it("an analyst can't reveal the email or the name", async () => {
    const payment = await newPayment(5_000);
    const maker = await analyst();
    await expect(revealCustomerEmail(maker, { paymentId: payment.id, reason: "Curious" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(revealCustomerName(maker, { paymentId: payment.id, reason: "Curious" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await auditFor(payment.id, "field.unmask")).toHaveLength(0);
  });

  it("the payment list and view show only the customer's first name and last initial", async () => {
    const payment = await newPayment(5_000);
    const { rows } = await searchPayments(db, { search: payment.reference });
    const view = await getPaymentView(db, payment.id);
    expect(rows[0]?.customerName).toBe("Test C.");
    expect(view?.customerName).toBe("Test C.");
    expect(JSON.stringify({ rows, view })).not.toContain(payment.customerName);
  });

  it("revealing the full name needs a reason", async () => {
    const payment = await newPayment(5_000);
    const checker = await approver();
    await expect(revealCustomerName(checker, { paymentId: payment.id, reason: "" })).rejects.toBeInstanceOf(ValidationError);
    expect(await auditFor(payment.id, "field.unmask")).toHaveLength(0);

    // Positive control: with a reason the full name comes back and the read is audited (without the value).
    const name = await revealCustomerName(checker, { paymentId: payment.id, reason: "Matching the bank statement" });
    expect(name).toBe(payment.customerName);
    const [row] = await auditFor(payment.id, "field.unmask");
    expect(row).toMatchObject({ entityType: "payment", reason: "Matching the bank statement", actorUserId: checker.user.id });
    expect(JSON.stringify(row)).not.toContain(payment.customerName);
  });

  it("refund audit rows never contain the customer email or full name", async () => {
    const { payment, refund } = await pendingRefund();
    await approveRefund(await approver(), { refundId: refund.id, expectedVersion: 1 });
    const history = await refundHistory(db, refund.id);
    expect(history.length).toBeGreaterThan(0);
    expect(JSON.stringify(history)).not.toContain(payment.customerEmail);
    expect(JSON.stringify(history)).not.toContain(payment.customerName);
  });
});

describe("rule 4: money moves once, and only when approved", () => {
  it("moves the money through the provider only when the refund is approved", async () => {
    const { payment, refund } = await pendingRefund(30_000);
    expect(await providerRows(refund.id)).toHaveLength(0);
    const approved = await approveRefund(await approver(), { refundId: refund.id, expectedVersion: 1, note: "Receipt checked" });
    const paid = await providerRows(refund.id);
    expect(paid).toHaveLength(1);
    expect(paid[0]).toMatchObject({ amountPence: 30_000, paymentReference: payment.reference });
    expect(approved).toMatchObject({ status: "succeeded", providerRefundId: paid[0]?.id });
    expect(await refundedPence(payment.id)).toBe(30_000);
    expect(await auditFor(refund.id, "refund.succeeded")).toHaveLength(1);
  });

  it("a rejected refund never moves money", async () => {
    const { payment, refund } = await pendingRefund();
    const rejected = await rejectRefund(await approver(), { refundId: refund.id, expectedVersion: 1, note: "No proof of return" });
    expect(rejected.status).toBe("rejected");
    expect(await providerRows(refund.id)).toHaveLength(0);
    expect(await refundedPence(payment.id)).toBe(0);
    expect(await auditFor(rejected.approval!.id, "approval.rejected")).toHaveLength(1);
  });

  it("a rejection marks the refund rejected and audits it in the same transaction", async () => {
    const { payment, refund } = await pendingRefund();
    await rejectRefund(await approver(), { refundId: refund.id, expectedVersion: 1, note: "Duplicate request" });
    const [row] = await refundRows(payment.id);
    expect(row?.status).toBe("rejected");
    const [audit] = await auditFor(refund.id, "refund.rejected");
    expect(audit).toMatchObject({ before: { status: "pending" }, after: { status: "rejected" } });
  });

  it("the database refuses to change a rejected refund", async () => {
    const { payment, refund } = await pendingRefund();
    await rejectRefund(await approver(), { refundId: refund.id, expectedVersion: 1, note: "Duplicate request" });
    await expectDbError(owner.update(refunds).set({ status: "succeeded" }).where(eq(refunds.id, refund.id)), /refund is already rejected/);
    expect((await refundRows(payment.id))[0]?.status).toBe("rejected");
  });

  it("approving twice moves the money once", async () => {
    const { payment, refund } = await pendingRefund(30_000);
    const checker = await approver();
    await approveRefund(checker, { refundId: refund.id, expectedVersion: 1 });
    await expect(approveRefund(checker, { refundId: refund.id, expectedVersion: 1 })).rejects.toBeInstanceOf(ConflictError);
    await expect(approveRefund(checker, { refundId: refund.id, expectedVersion: 2 })).rejects.toBeInstanceOf(ConflictError);
    expect(await providerRows(refund.id)).toHaveLength(1);
    expect(await refundedPence(payment.id)).toBe(30_000);
  });

  it("two approvers approving at the same time move the money once", async () => {
    const { payment, refund } = await pendingRefund(30_000);
    const [a, b] = [await approver(), await approver()];
    const results = await Promise.allSettled([
      approveRefund(a, { refundId: refund.id, expectedVersion: 1 }),
      approveRefund(b, { refundId: refund.id, expectedVersion: 1 }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await providerRows(refund.id)).toHaveLength(1);
    expect(await refundedPence(payment.id)).toBe(30_000);
  });

  it("a double-submitted request creates one refund", async () => {
    const payment = await newPayment(100_000);
    const maker = await analyst();
    const big = refundInput(payment.id, 30_000);
    const first = await requestRefund(maker, big, config);
    const again = await requestRefund(maker, big, config);
    expect(again.id).toBe(first.id);

    const small = refundInput(payment.id, 2_000);
    const both = await Promise.allSettled([requestRefund(maker, small, config), requestRefund(maker, small, config)]);
    expect(both.every((r) => r.status === "fulfilled")).toBe(true);

    expect((await refundRows(payment.id)).map((r) => r.id).sort()).toEqual([big.refundId, small.refundId].sort());
    const requests = await db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, big.refundId));
    expect(requests).toHaveLength(1);
    expect(await providerRows(small.refundId)).toHaveLength(1);
    expect(await refundedPence(payment.id)).toBe(2_000);
  });

  it("the database refuses to re-process a succeeded refund", async () => {
    const payment = await newPayment(5_000);
    const refund = await requestRefund(await analyst(), refundInput(payment.id, 1_000), config);
    await expectDbError(db.update(refunds).set({ status: "pending" }).where(eq(refunds.id, refund.id)), /refund is already succeeded/);
  });
});

describe("rule 5: total refunds never exceed the original amount", () => {
  it("rejects a refund that would take the total over the payment amount", async () => {
    const payment = await newPayment(10_000);
    const maker = await analyst();
    await requestRefund(maker, refundInput(payment.id, 6_000), config);
    await expect(requestRefund(maker, refundInput(payment.id, 5_000), config)).rejects.toBeInstanceOf(ValidationError);
    // Positive control: the remaining amount is still refundable.
    await requestRefund(maker, refundInput(payment.id, 4_000), config);
    expect(await refundedPence(payment.id)).toBe(10_000);
  });

  it("counts refunds awaiting approval against what's left, and frees them when rejected", async () => {
    const payment = await newPayment(50_000);
    const maker = await analyst();
    const held = await requestRefund(maker, refundInput(payment.id, 30_000), config);
    await expect(requestRefund(maker, refundInput(payment.id, 30_000), config)).rejects.toBeInstanceOf(ValidationError);
    await rejectRefund(await approver(), { refundId: held.id, expectedVersion: 1, note: "Wrong amount" });
    // Positive control: once rejected, the amount is available again.
    expect((await requestRefund(maker, refundInput(payment.id, 30_000), config)).status).toBe("pending_approval");
  });

  it("two people requesting at the same time can't over-refund", async () => {
    for (const [total, each] of [
      [10_000, 6_000],
      [50_000, 30_000],
    ] as const) {
      const payment = await newPayment(total);
      const [a, b] = [await analyst(), await analyst()];
      const results = await Promise.allSettled([
        requestRefund(a, refundInput(payment.id, each), config),
        requestRefund(b, refundInput(payment.id, each), config),
      ]);
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = results.find((r) => r.status === "rejected");
      expect(rejected?.status === "rejected" && rejected.reason).toBeInstanceOf(ValidationError);
      expect(await refundRows(payment.id)).toHaveLength(1);
    }
  });

  it("the database rejects refunded_pence above the payment amount", async () => {
    const payment = await newPayment(10_000);
    await expectDbError(
      db.update(payments).set({ refundedPence: 10_001 }).where(eq(payments.id, payment.id)),
      /payments_refund_within_amount/,
    );
    // Positive control: up to the amount is allowed.
    await db.update(payments).set({ refundedPence: 10_000 }).where(eq(payments.id, payment.id));
  });

  it("the app role can't change a payment's amount", async () => {
    const payment = await newPayment(10_000);
    await expectDbError(db.update(payments).set({ amountPence: 1_000_000 }).where(eq(payments.id, payment.id)), /permission denied/);
  });
});

describe("rule 6: approvers get a queue, and every refund shows its history", () => {
  it("lists pending refunds in the approvers' queue until they are decided", async () => {
    const { refund } = await pendingRefund();
    const checker = await approver();
    const before = await listPendingRefundApprovals(checker, { pageSize: 1000 });
    expect(before.rows.map((r) => r.refundId)).toContain(refund.id);
    await approveRefund(checker, { refundId: refund.id, expectedVersion: 1 });
    const after = await listPendingRefundApprovals(checker, { pageSize: 1000 });
    expect(after.rows.map((r) => r.refundId)).not.toContain(refund.id);
  });

  it("an analyst can't open the approvals queue", async () => {
    const maker = await analyst();
    await expect(listPendingRefundApprovals(maker, {})).rejects.toBeInstanceOf(ForbiddenError);
    const denials = await db.select().from(auditLog).where(and(eq(auditLog.actorUserId, maker.user.id), eq(auditLog.action, "access.denied")));
    expect(denials).toHaveLength(1);
  });

  it("shows an approved refund's history, newest first", async () => {
    const { refund } = await pendingRefund();
    await approveRefund(await approver(), { refundId: refund.id, expectedVersion: 1, note: "OK" });
    const actions = (await refundHistory(db, refund.id)).map((h) => h.action);
    expect(actions).toEqual(["approval.approved", "refund.succeeded", "approval.requested", "refund.requested"]);
  });

  it("shows a straight-through refund's history", async () => {
    const payment = await newPayment(5_000);
    const refund = await requestRefund(await analyst(), refundInput(payment.id, 1_000), config);
    expect((await refundHistory(db, refund.id)).map((h) => h.action)).toEqual(["refund.succeeded", "refund.requested"]);
  });
});

