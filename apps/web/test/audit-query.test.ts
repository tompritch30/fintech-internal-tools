import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, payments } from "@fit/db";
import { makeUser, ownerDb } from "../../../packages/core/test/helpers/db.ts";
import { TEST_DATABASE_URL } from "../../../packages/core/test/helpers/env.ts";
import { parseAuditFilters, searchAudit } from "../app/(platform)/audit/query.ts";
import { requestRefund } from "../app/(platform)/refunds/refunds.ts";

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.$client.end());
const owner = ownerDb();
const PAGE = { page: 1, pageSize: 500, dir: "desc" as const };
const day = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

async function refundBy() {
  const n = randomUUID().slice(0, 8);
  const [payment] = await owner
    .insert(payments)
    .values({ reference: `PAY-A-${n}`, customerName: `Audit Customer${n}`, customerEmail: `audit.${n}@example.test`, merchant: "Test Merchant", cardBrand: "Visa", cardLast4: "4242", amountPence: 10_000, capturedAt: new Date() })
    .returning();
  if (!payment) throw new Error("payment insert failed");
  const ctx = { db, user: (await makeUser(db, ["analyst"])).user };
  const refund = await requestRefund(ctx, { refundId: randomUUID(), paymentId: payment.id, amountPence: 1_000, reason: "Customer returned the item" }, { approvalThresholdPence: 25_000 });
  return { user: ctx.user, refund };
}

describe("audit log filters", () => {
  it("filters by user: only that user's rows", async () => {
    const a = await refundBy();
    const b = await refundBy();
    const { rows } = await searchAudit(db, { user: a.user.username }, PAGE);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.actor === a.user.username)).toBe(true);
    expect(rows.some((r) => r.entityId === a.refund.id)).toBe(true);
    expect(rows.some((r) => r.entityId === b.refund.id)).toBe(false);
  });

  it("filters by action and by the start of a record ID", async () => {
    const { refund } = await refundBy();
    const { rows } = await searchAudit(db, { action: "refund.requested", recordType: "refund", recordId: refund.id.slice(0, 13) }, PAGE);
    expect(rows.map((r) => [r.action, r.entityId])).toEqual([["refund.requested", refund.id]]);
  });

  it("includes both ends of the date range and excludes days outside it", async () => {
    const { refund } = await refundBy();
    expect((await searchAudit(db, { from: day(0), to: day(0), recordId: refund.id }, PAGE)).total).toBeGreaterThan(0);
    expect((await searchAudit(db, { to: day(-1), recordId: refund.id }, PAGE)).total).toBe(0);
    expect((await searchAudit(db, { from: day(1), recordId: refund.id }, PAGE)).total).toBe(0);
  });

  it("treats wildcards in the record ID literally", async () => {
    await refundBy();
    expect((await searchAudit(db, {}, PAGE)).total).toBeGreaterThan(0);
    expect((await searchAudit(db, { recordId: "%" }, PAGE)).total).toBe(0);
  });

  it("drops malformed dates and blank values instead of guessing", () => {
    expect(parseAuditFilters({ from: "2026-02-30", to: "yesterday", user: "  ", action: "refund.requested" })).toEqual({
      from: undefined,
      to: undefined,
      user: undefined,
      action: "refund.requested",
      recordType: undefined,
      recordId: undefined,
    });
  });
});
