import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { requirePermission } from "@fit/core";
import { and, eq } from "drizzle-orm";
import { createDb, flagValues, flags, kycCases, payments, users } from "@fit/db";
import { makeUser, ownerDb } from "../../../packages/core/test/helpers/db.ts";
import { TEST_DATABASE_URL } from "../../../packages/core/test/helpers/env.ts";
import { awaitingMyApproval, myRecentActivity } from "../app/(platform)/dashboard.ts";
import { changeFlag } from "../app/(platform)/flags/flags.ts";
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

async function pendingFlagChangeBy(roles: string[]) {
  const [flag] = await owner.insert(flags).values({ key: `dash-${randomUUID().slice(0, 8)}`, description: "Dashboard test flag" }).returning();
  if (!flag) throw new Error("flag insert failed");
  await owner.insert(flagValues).values((["dev", "staging", "prod"] as const).map((environment) => ({ flagId: flag.id, environment, enabled: false, rolloutPercentage: 0 })));
  const [prod] = await owner.select().from(flagValues).where(and(eq(flagValues.flagId, flag.id), eq(flagValues.environment, "prod")));
  const maker = await as(roles);
  const result = await changeFlag(maker, { flagId: flag.id, environment: "prod", enabled: true, rolloutPercentage: 25, reason: "Start the rollout", expectedVersion: prod?.version ?? 0, changeId: randomUUID() });
  if (!result.flag.pendingChange) throw new Error("expected a pending prod change");
  return { flag, maker, change: result.flag.pendingChange };
}

const ids = async (user: Awaited<ReturnType<typeof as>>["user"]) => (await awaitingMyApproval(db, user, ALL)).items.map((i) => i.id);

describe("dashboard: items waiting for my approval", () => {
  it("lists a refund waiting for approval to a different approver", async () => {
    const { refund } = await pendingRefundBy(["analyst"]);
    const { user } = await as(["approver"]);
    const item = (await awaitingMyApproval(db, user, ALL)).items.find((i) => i.id === refund.id);
    expect(item).toMatchObject({ kind: "Refund", href: `/refunds/requests/${refund.id}` });
  });

  it("counts each kind separately, so a full list of sign-offs can't hide waiting refunds", async () => {
    await pendingRefundBy(["analyst"]);
    const { user } = await as(["approver"]);
    const all = await awaitingMyApproval(db, user, ALL);
    const one = await awaitingMyApproval(db, user, { limit: 1 });
    expect(one.items).toHaveLength(1);
    const refunds = all.items.filter((i) => i.kind === "Refund").length;
    expect(refunds).toBeGreaterThan(0);
    const kinds = (kind: string) => all.items.filter((i) => i.kind === kind).length;
    expect(one.byKind).toEqual({ refunds, kyc: kinds("KYC sign-off"), flags: kinds("Flag change") });
    expect(one.total).toBe(all.items.length);
  });

  it("leaves out a refund the approver requested themselves", async () => {
    const { maker, refund } = await pendingRefundBy(["analyst", "approver"]);
    expect(await ids(maker.user)).not.toContain(refund.id);
    // Positive control: a different approver sees it.
    expect(await ids((await as(["approver"])).user)).toContain(refund.id);
  });

  it("shows nothing to a user without approver rights", async () => {
    await pendingRefundBy(["analyst"]);
    expect(await awaitingMyApproval(db, (await as(["analyst"])).user, ALL)).toEqual({ items: [], total: 0, byKind: { refunds: 0, kyc: 0, flags: 0 } });
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

describe("dashboard: flag approvals and requester names", () => {
  it("lists a prod flag change for a different approver, not for the approver who asked", async () => {
    const { flag, maker, change } = await pendingFlagChangeBy(["analyst", "approver"]);
    expect(await ids(maker.user)).not.toContain(change.id);
    const item = (await awaitingMyApproval(db, (await as(["approver"])).user, ALL)).items.find((i) => i.id === change.id);
    expect(item).toMatchObject({ kind: "Flag change", title: `${flag.key}: prod Off → On · 25%`, href: `/flags/${flag.id}` });
  });

  it("counts waiting flag changes only for users who can approve them", async () => {
    await pendingFlagChangeBy(["analyst"]);
    expect((await awaitingMyApproval(db, (await as(["approver"])).user, ALL)).byKind.flags).toBeGreaterThan(0);
    expect((await awaitingMyApproval(db, (await as(["analyst"])).user, ALL)).byKind.flags).toBe(0);
  });

  it("names the requester by display name and keeps the username for hover", async () => {
    const { maker, refund } = await pendingRefundBy(["analyst"]);
    await owner.update(users).set({ displayName: "Riley Requester" }).where(eq(users.id, maker.user.id));
    const item = (await awaitingMyApproval(db, (await as(["approver"])).user, ALL)).items.find((i) => i.id === refund.id);
    expect(item).toMatchObject({ requestedByName: "Riley Requester", requestedByUsername: maker.user.username });
  });
});

describe("dashboard: recent activity", () => {
  it("shows the user's own actions, linked to the record", async () => {
    const { maker, refund } = await pendingRefundBy(["analyst"]);
    const mine = await myRecentActivity(db, maker.user);
    expect(mine.find((a) => a.action === "refund.requested")).toMatchObject({ href: `/refunds/requests/${refund.id}` });
  });

  it("leaves out the user's sign-ins and access denials", async () => {
    const { maker, refund } = await pendingRefundBy(["analyst"]);
    await expect(requirePermission({ db, user: maker.user, resource: `/audit-${refund.id}` }, "audit:read")).rejects.toThrow();
    const actions = (await myRecentActivity(db, maker.user)).map((a) => a.action);
    expect(actions).not.toContain("access.denied");
    // Positive control: the user's own refund request is still there.
    expect(actions).toContain("refund.requested");
  });

  it("names each record in plain words and links a flag change to its flag", async () => {
    const [flag] = await owner.insert(flags).values({ key: `dash-${randomUUID().slice(0, 8)}`, description: "Dashboard test flag" }).returning();
    if (!flag) throw new Error("flag insert failed");
    await owner.insert(flagValues).values((["dev", "staging", "prod"] as const).map((environment) => ({ flagId: flag.id, environment, enabled: false, rolloutPercentage: 0 })));
    const [dev] = await owner.select().from(flagValues).where(and(eq(flagValues.flagId, flag.id), eq(flagValues.environment, "dev")));
    const engineer = await as(["analyst"]);
    await changeFlag(engineer, { flagId: flag.id, environment: "dev", enabled: true, rolloutPercentage: 10, reason: "Dashboard test", expectedVersion: dev?.version ?? 0, changeId: randomUUID() });
    const change = (await myRecentActivity(db, engineer.user)).find((a) => a.action === "flag.value_changed");
    expect(change).toMatchObject({ record: `Feature flag ${flag.id.slice(0, 8)}`, href: `/flags/${flag.id}` });
    // Positive control: refunds keep their link and read as "Refund …", not the raw entity type.
    const { maker, refund } = await pendingRefundBy(["analyst"]);
    expect((await myRecentActivity(db, maker.user)).find((a) => a.action === "refund.requested")).toMatchObject({ record: `Refund ${refund.id.slice(0, 8)}`, href: `/refunds/requests/${refund.id}` });
  });

  it("never shows another user's actions", async () => {
    await pendingRefundBy(["analyst"]);
    expect(await myRecentActivity(db, (await as(["analyst"])).user)).toEqual([]);
  });
});
