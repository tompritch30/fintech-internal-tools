import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { createDb, kycCases, payments } from "@fit/db";
import { makeUser, ownerDb } from "../../../packages/core/test/helpers/db.ts";
import { TEST_DATABASE_URL } from "../../../packages/core/test/helpers/env.ts";
import { awaitingMyApproval, myRecentActivity } from "../app/(platform)/dashboard.ts";
import { claimCase, decideCase } from "../app/(platform)/kyc/kyc.ts";
import { requestRefund } from "../app/(platform)/refunds/refunds.ts";

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.$client.end());
const owner = ownerDb();
const as = async (roles: string[]) => ({ db, user: (await makeUser(db, roles)).user });
const ALL = { limit: 100_000 };

async function pendingRefundBy(roles: string[]) {
  const n = randomUUID().slice(0, 8);
  const [payment] = await owner
    .insert(payments)
    .values({ reference: `PAY-D-${n}`, customerName: `Dash Customer${n}`, customerEmail: `dash.${n}@example.test`, merchant: "Test Merchant", cardBrand: "Visa", cardLast4: "4242", amountPence: 100_000, capturedAt: new Date() })
    .returning();
  if (!payment) throw new Error("payment insert failed");
  const maker = await as(roles);
  const refund = await requestRefund(maker, { refundId: randomUUID(), paymentId: payment.id, amountPence: 30_000, reason: "Customer returned the item" }, { approvalThresholdPence: 25_000 });
  return { maker, refund };
}

const ids = async (user: Awaited<ReturnType<typeof as>>["user"]) => (await awaitingMyApproval(db, user, ALL)).items.map((i) => i.id);

describe("dashboard: items waiting for my approval", () => {
  it("lists a refund waiting for approval to a different approver", async () => {
    const { refund } = await pendingRefundBy(["analyst"]);
    const { user } = await as(["approver"]);
    const item = (await awaitingMyApproval(db, user, ALL)).items.find((i) => i.id === refund.id);
    expect(item).toMatchObject({ kind: "Refund", href: `/refunds/requests/${refund.id}` });
  });

  it("leaves out a refund the approver requested themselves", async () => {
    const { maker, refund } = await pendingRefundBy(["analyst", "approver"]);
    expect(await ids(maker.user)).not.toContain(refund.id);
    // Positive control: a different approver sees it.
    expect(await ids((await as(["approver"])).user)).toContain(refund.id);
  });

  it("shows nothing to a user without approver rights", async () => {
    await pendingRefundBy(["analyst"]);
    expect(await awaitingMyApproval(db, (await as(["analyst"])).user, ALL)).toEqual({ items: [], total: 0 });
  });

  it("lists a high-risk KYC sign-off for a different approver, not for the analyst-approver who asked", async () => {
    const n = randomUUID().slice(0, 8);
    const [kase] = await owner
      .insert(kycCases)
      .values({ reference: `KYC-D-${n}`, applicantName: `Dash Applicant${n}`, dateOfBirth: "1971-11-23", idNumber: `TST-${n}`, address: `${n} Example Lane`, nationality: "GB", riskRating: "high" })
      .returning();
    if (!kase) throw new Error("case insert failed");
    const senior = await as(["analyst", "approver"]);
    await claimCase(senior, { caseId: kase.id });
    await decideCase(senior, { caseId: kase.id, decision: "approve" }, { retentionYears: 5 });
    expect(await ids(senior.user)).not.toContain(kase.id);
    const item = (await awaitingMyApproval(db, (await as(["approver"])).user, ALL)).items.find((i) => i.id === kase.id);
    expect(item).toMatchObject({ kind: "KYC sign-off", href: `/kyc/cases/${kase.id}` });
  });
});

describe("dashboard: recent activity", () => {
  it("shows the user's own actions, linked to the record", async () => {
    const { maker, refund } = await pendingRefundBy(["analyst"]);
    const mine = await myRecentActivity(db, maker.user);
    expect(mine.find((a) => a.action === "refund.requested")).toMatchObject({ href: `/refunds/requests/${refund.id}` });
  });

  it("never shows another user's actions", async () => {
    await pendingRefundBy(["analyst"]);
    expect(await myRecentActivity(db, (await as(["analyst"])).user)).toEqual([]);
  });
});
