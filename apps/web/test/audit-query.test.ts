import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ForbiddenError, withAudit } from "@fit/core";
import { auditLog, createDb, flags, kycCases, payments, users } from "@fit/db";
import { seedKycCases } from "@fit/db/seed";
import { makeUser, ownerDb } from "../../../packages/core/test/helpers/db.ts";
import { TEST_DATABASE_URL } from "../../../packages/core/test/helpers/env.ts";
import { csvCell, exportAudit, parseAuditFilters, searchAudit } from "../app/(platform)/audit/query.ts";
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

  it("uses the first value when a filter is repeated in the URL", () => {
    expect(parseAuditFilters({ action: ["refund.requested", "auth.login"], from: ["2026-10-01", "x"] })).toMatchObject({ action: "refund.requested", from: "2026-10-01" });
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

const SYSTEM = { id: null, subject: null };
const auditRow = (entityType: string, entityId: string) =>
  withAudit(owner, { actor: SYSTEM, action: "test.touched", entityType, entityId, reason: "Audit label test" }, async () => undefined);

async function records() {
  const { refund } = await refundBy();
  const [payment] = await owner.select().from(payments).where(eq(payments.id, refund.paymentId));
  await auditRow("payment", payment!.id);
  const [kase] = await owner.insert(kycCases).values({ ...seedKycCases(1)[0]!.kase, reference: `KYC-A-${randomUUID().slice(0, 8)}` }).returning();
  await auditRow("kyc_case", kase!.id);
  const [flag] = await owner.insert(flags).values({ key: `audit-label-${randomUUID().slice(0, 8)}`, description: "Audit label test" }).returning();
  await auditRow("flag", flag!.id);
  return { refund, payment: payment!, kase: kase!, flag: flag! };
}

describe("audit log: human record IDs, search and CSV export", () => {
  it("shows the human ID (PAY-, KYC-, flag key) linked to the record instead of the raw ID", async () => {
    const { refund, payment, kase, flag } = await records();
    const row = async (entityId: string) => (await searchAudit(db, { recordId: entityId }, PAGE)).rows.find((r) => r.entityId === entityId);
    expect(await row(payment.id)).toMatchObject({ recordLabel: payment.reference, recordHref: `/refunds/payments/${payment.id}` });
    expect(await row(refund.id)).toMatchObject({ recordLabel: `Refund on ${payment.reference}`, recordHref: `/refunds/requests/${refund.id}` });
    expect(await row(kase.id)).toMatchObject({ recordLabel: kase.reference, recordHref: `/kyc/cases/${kase.id}` });
    expect(await row(flag.id)).toMatchObject({ recordLabel: flag.key, recordHref: `/flags/${flag.id}` });
  });

  it("finds rows by human ID as well as by raw ID", async () => {
    const { refund, payment, kase, flag } = await records();
    const ids = async (q: string) => (await searchAudit(db, { recordId: q }, PAGE)).rows.map((r) => r.entityId);
    expect(await ids(payment.reference)).toEqual(expect.arrayContaining([payment.id, refund.id]));
    expect(await ids(kase.reference.toLowerCase())).toContain(kase.id);
    expect(await ids(flag.key)).toEqual([flag.id]);
    // Positive control: the raw ID still works, and an unrelated ID matches nothing of these.
    expect(await ids(refund.id.slice(0, 13))).toContain(refund.id);
    expect(await ids(`PAY-NOPE-${randomUUID()}`)).toEqual([]);
  });

  it("shows who did it by display name, keeping the username for hover", async () => {
    const { user, refund } = await refundBy();
    await owner.update(users).set({ displayName: "Audit Display Name" }).where(eq(users.id, user.id));
    const [row] = (await searchAudit(db, { recordId: refund.id }, PAGE)).rows;
    expect(row).toMatchObject({ actorName: "Audit Display Name", actorUsername: user.username });
  });

  it("exports exactly the filtered rows as CSV, for audit:read only, and records the export", async () => {
    const { payment, refund } = await records();
    const other = await refundBy();
    const admin = (await makeUser(db, ["admin"])).user;
    const { csv, rowCount, truncated } = await exportAudit({ db, user: admin }, { recordId: payment.reference });
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe('"When (UTC)","Who","Username","Action","Record type","Record","Record ID","Reason"');
    expect(lines.length - 1).toBe(rowCount);
    expect(rowCount).toBeGreaterThanOrEqual(2);
    expect(truncated).toBe(false);
    expect(csv).toContain(refund.id);
    expect(csv).not.toContain(other.refund.id);
    const exported = await owner.select().from(auditLog).where(and(eq(auditLog.actorUserId, admin.id), eq(auditLog.action, "audit.exported")));
    expect(exported).toHaveLength(1);
    expect(exported[0]?.metadata).toMatchObject({ filters: { recordId: payment.reference }, rowCount, truncated: false });
  });

  it("refuses the export without audit:read", async () => {
    const analyst = (await makeUser(db, ["analyst"])).user;
    await expect(exportAudit({ db, user: analyst }, {})).rejects.toBeInstanceOf(ForbiddenError);
    const exported = await owner.select().from(auditLog).where(and(eq(auditLog.actorUserId, analyst.id), eq(auditLog.action, "audit.exported")));
    expect(exported).toEqual([]);
  });

  it("quotes CSV cells and stops spreadsheet formulas running", () => {
    expect(csvCell('said "no", twice')).toBe('"said ""no"", twice"');
    expect(csvCell("=HYPERLINK(1)")).toBe(`"'=HYPERLINK(1)"`);
    for (const c of ["+", "-", "@", "\t", "\r"]) expect(csvCell(`${c}1`)).toBe(`"'${c}1"`);
    expect(csvCell(null)).toBe('""');
    expect(csvCell("Plain reason")).toBe('"Plain reason"');
  });
});
