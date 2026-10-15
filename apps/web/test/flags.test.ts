import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, SelfApprovalError, ValidationError, permissionsFor } from "@fit/core";
import { auditLog, createDb, flagChanges, flagValues, flags, type FlagEnvironment } from "@fit/db";
import { SEED_FLAGS } from "@fit/db/seed";
import { expectDbError, makeUser, ownerDb } from "../../../packages/core/test/helpers/db.ts";
import { TEST_DATABASE_URL } from "../../../packages/core/test/helpers/env.ts";
import {
  approveFlagChange,
  changeFlag,
  flagHistory,
  getFlagView,
  killFlag,
  listFlags,
  listPendingFlagChanges,
  loadFlagsServiceConfig,
  parseRolloutPercentage,
  rejectFlagChange,
  serviceFlagValues,
  type FlagChangeInput,
  type FlagValue,
} from "../app/(platform)/flags/flags.ts";
import { describeFlagAudit } from "../app/(platform)/flags/format.ts";
import { handleFlagsServiceRequest } from "../app/(platform)/flags/service.ts";

const db = createDb(TEST_DATABASE_URL, { max: 6 });
afterAll(() => db.$client.end());
const owner = ownerDb();

const analyst = async () => ({ db, user: (await makeUser(db, ["analyst"])).user });
const approver = async () => ({ db, user: (await makeUser(db, ["approver"])).user });
const senior = async () => ({ db, user: (await makeUser(db, ["analyst", "approver"])).user });

type Values = Partial<Record<FlagEnvironment, FlagValue>>;
const OFF: FlagValue = { enabled: false, rolloutPercentage: 0 };

/** Flags are created by the seed role only (app_runtime can't insert them). */
async function newFlag(values: Values = {}) {
  const key = `test-${randomUUID().slice(0, 8)}`;
  const [flag] = await owner.insert(flags).values({ key, description: "Test flag" }).returning();
  if (!flag) throw new Error("flag insert failed");
  await owner.insert(flagValues).values(
    (["dev", "staging", "prod"] as const).map((environment) => ({ flagId: flag.id, environment, ...(values[environment] ?? OFF) })),
  );
  return flag;
}

const valueOf = async (flagId: string, environment: FlagEnvironment) => {
  const [row] = await db
    .select()
    .from(flagValues)
    .where(and(eq(flagValues.flagId, flagId), eq(flagValues.environment, environment)));
  if (!row) throw new Error("missing flag value");
  return row;
};

async function input(flagId: string, environment: FlagEnvironment, value: FlagValue, extra: Partial<FlagChangeInput> = {}) {
  const current = await valueOf(flagId, environment);
  return {
    flagId,
    environment,
    ...value,
    reason: "Rolling out to more traffic",
    expectedVersion: current.version,
    changeId: randomUUID(),
    ...extra,
  } satisfies FlagChangeInput;
}

const auditFor = (entityId: string, action?: string) =>
  db
    .select()
    .from(auditLog)
    .where(action ? and(eq(auditLog.entityId, entityId), eq(auditLog.action, action)) : eq(auditLog.entityId, entityId));

const changesFor = (flagId: string) => db.select().from(flagChanges).where(eq(flagChanges.flagId, flagId));

async function pendingProdChange(after: FlagValue = { enabled: true, rolloutPercentage: 25 }, before: Values = {}) {
  const flag = await newFlag(before);
  const maker = await analyst();
  const result = await changeFlag(maker, await input(flag.id, "prod", after));
  const change = result.flag.pendingChange;
  if (!change) throw new Error("expected a pending change");
  return { flag, maker, change };
}

const TOKEN = "test-service-token-0123456789";
const serviceRequest = (query: string, token: string | null = TOKEN, method = "GET") =>
  new Request(`http://localhost:3000/api/flags${query}`, {
    method,
    headers: token === null ? {} : { authorization: `Bearer ${token}` },
  });

describe("flags permissions come from the registry", () => {
  it("analysts change and request, approvers approve, both read; admins get none", () => {
    expect([...permissionsFor(["analyst"])]).toEqual(expect.arrayContaining(["flags:read", "flags:request"]));
    expect([...permissionsFor(["approver"])]).toEqual(expect.arrayContaining(["flags:read", "flags:approve"]));
    expect(permissionsFor(["analyst"]).has("flags:approve")).toBe(false);
    expect(permissionsFor(["approver"]).has("flags:request")).toBe(false);
    for (const p of ["flags:read", "flags:request", "flags:approve"] as const) expect(permissionsFor(["admin"]).has(p)).toBe(false);
  });
});

describe("rule 1: every flag has a value in dev, staging and prod", () => {
  it("every seeded flag has exactly one value per environment", async () => {
    expect(SEED_FLAGS.length).toBeGreaterThan(0);
    const seeded = (await listFlags(db)).filter((f) => SEED_FLAGS.some((s) => s.key === f.key));
    expect(seeded).toHaveLength(SEED_FLAGS.length);
    for (const flag of seeded) {
      const rows = await db.select().from(flagValues).where(eq(flagValues.flagId, flag.id));
      expect(rows.map((r) => r.environment).sort()).toEqual(["dev", "prod", "staging"]);
    }
  });

  it("the flag view shows each environment's own value", async () => {
    const flag = await newFlag({ dev: { enabled: true, rolloutPercentage: 100 }, staging: { enabled: true, rolloutPercentage: 30 } });
    const view = await getFlagView(db, flag.id);
    expect(view?.values.dev).toMatchObject({ enabled: true, rolloutPercentage: 100 });
    expect(view?.values.staging).toMatchObject({ enabled: true, rolloutPercentage: 30 });
    expect(view?.values.prod).toMatchObject(OFF);
  });

  it("changing dev leaves staging and prod untouched", async () => {
    const flag = await newFlag();
    await changeFlag(await analyst(), await input(flag.id, "dev", { enabled: true, rolloutPercentage: 40 }));
    expect(await valueOf(flag.id, "dev")).toMatchObject({ enabled: true, rolloutPercentage: 40 });
    expect(await valueOf(flag.id, "staging")).toMatchObject(OFF);
    expect(await valueOf(flag.id, "prod")).toMatchObject(OFF);
  });

  it("rejects an unknown environment", async () => {
    const flag = await newFlag();
    const bad = { ...(await input(flag.id, "dev", { enabled: true, rolloutPercentage: 1 })), environment: "qa" as FlagEnvironment };
    await expect(changeFlag(await analyst(), bad)).rejects.toThrow(ValidationError);
  });

  it("the app role can't add or delete an environment's value", async () => {
    const flag = await newFlag();
    await expectDbError(db.delete(flagValues).where(eq(flagValues.flagId, flag.id)), /permission denied/);
    await expectDbError(db.insert(flagValues).values({ flagId: flag.id, environment: "dev" }), /permission denied/);
  });

  it("the database refuses to move a value to another environment", async () => {
    const flag = await newFlag();
    await expectDbError(
      owner
        .update(flagValues)
        .set({ environment: "prod", version: 2 })
        .where(and(eq(flagValues.flagId, flag.id), eq(flagValues.environment, "dev"))),
      /immutable|duplicate key/,
    );
  });
});

describe("rule 2: engineers change dev and staging directly", () => {
  it("applies a dev change at once and audits it with before and after", async () => {
    const flag = await newFlag();
    const maker = await analyst();
    const { outcome } = await changeFlag(maker, await input(flag.id, "dev", { enabled: true, rolloutPercentage: 50 }));
    expect(outcome).toBe("applied");
    expect(await valueOf(flag.id, "dev")).toMatchObject({ enabled: true, rolloutPercentage: 50, updatedBy: maker.user.id });
    const [row] = await auditFor(flag.id, "flag.value_changed");
    expect(row).toMatchObject({ actorUserId: maker.user.id, entityType: "flag", reason: "Rolling out to more traffic" });
    expect(row?.before).toEqual({ environment: "dev", enabled: false, rolloutPercentage: 0 });
    expect(row?.after).toMatchObject({ environment: "dev", enabled: true, rolloutPercentage: 50 });
    expect(await changesFor(flag.id)).toHaveLength(0);
  });

  it("applies a staging change at once without an approval request", async () => {
    const flag = await newFlag();
    const { outcome } = await changeFlag(await analyst(), await input(flag.id, "staging", { enabled: true, rolloutPercentage: 10 }));
    expect(outcome).toBe("applied");
    expect(await valueOf(flag.id, "staging")).toMatchObject({ enabled: true, rolloutPercentage: 10 });
    expect(await changesFor(flag.id)).toHaveLength(0);
  });

  it("rejects a change without a reason and writes nothing", async () => {
    const flag = await newFlag();
    await expect(
      changeFlag(await analyst(), await input(flag.id, "dev", { enabled: true, rolloutPercentage: 5 }, { reason: "   " })),
    ).rejects.toThrow(ValidationError);
    expect(await valueOf(flag.id, "dev")).toMatchObject(OFF);
    expect(await auditFor(flag.id)).toHaveLength(0);
  });

  it("rejects a change that changes nothing", async () => {
    const flag = await newFlag();
    await expect(changeFlag(await analyst(), await input(flag.id, "dev", OFF))).rejects.toThrow(ValidationError);
    expect(await auditFor(flag.id)).toHaveLength(0);
  });

  it("rejects an edit made against an old version", async () => {
    const flag = await newFlag();
    const maker = await analyst();
    const stale = await input(flag.id, "dev", { enabled: true, rolloutPercentage: 20 });
    await changeFlag(maker, await input(flag.id, "dev", { enabled: true, rolloutPercentage: 10 }));
    await expect(changeFlag(maker, stale)).rejects.toThrow(ConflictError);
    expect(await valueOf(flag.id, "dev")).toMatchObject({ rolloutPercentage: 10 });
    // positive control: the same edit against the current version applies
    await changeFlag(maker, await input(flag.id, "dev", { enabled: true, rolloutPercentage: 20 }));
    expect(await valueOf(flag.id, "dev")).toMatchObject({ rolloutPercentage: 20 });
  });

  it("denies a user without flags:request and audits the denial", async () => {
    const flag = await newFlag();
    const checker = await approver();
    await expect(changeFlag(checker, await input(flag.id, "dev", { enabled: true, rolloutPercentage: 5 }))).rejects.toThrow(
      ForbiddenError,
    );
    const denied = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.actorUserId, checker.user.id), eq(auditLog.action, "access.denied")));
    expect(denied).toHaveLength(1);
    expect(await valueOf(flag.id, "dev")).toMatchObject(OFF);
  });

  it("the database refuses an update that doesn't bump the version", async () => {
    const flag = await newFlag();
    await expectDbError(
      db
        .update(flagValues)
        .set({ enabled: true })
        .where(and(eq(flagValues.flagId, flag.id), eq(flagValues.environment, "dev"))),
      /version must increase by one/,
    );
  });
});

describe("rule 3: turning a flag on or changing it in prod needs a different approver", () => {
  it("holds turning a flag on in prod for approval and leaves prod unchanged", async () => {
    const { flag, maker, change } = await pendingProdChange();
    expect(change).toMatchObject({ status: "pending", before: OFF, after: { enabled: true, rolloutPercentage: 25 } });
    expect(change.requestedBy).toBe(maker.user.id);
    expect(await valueOf(flag.id, "prod")).toMatchObject(OFF);
    expect(await auditFor(flag.id, "flag.change_requested")).toHaveLength(1);
    expect(await auditFor(change.approval.id, "approval.requested")).toHaveLength(1);
  });

  it("holds a prod rollout change for approval even when the flag stays on", async () => {
    const { flag, change } = await pendingProdChange({ enabled: true, rolloutPercentage: 50 }, { prod: { enabled: true, rolloutPercentage: 10 } });
    expect(change.status).toBe("pending");
    expect(await valueOf(flag.id, "prod")).toMatchObject({ enabled: true, rolloutPercentage: 10 });
  });

  it("holds a rollout change on a flag that is off in prod for approval", async () => {
    const { flag, change } = await pendingProdChange({ enabled: false, rolloutPercentage: 30 });
    expect(change.status).toBe("pending");
    expect(await valueOf(flag.id, "prod")).toMatchObject(OFF);
  });

  it("applies the change when a different approver approves, and audits it", async () => {
    const { flag, change } = await pendingProdChange();
    const checker = await approver();
    const decided = await approveFlagChange(checker, { changeId: change.id, expectedVersion: change.approval.version });
    expect(decided.status).toBe("applied");
    expect(await valueOf(flag.id, "prod")).toMatchObject({ enabled: true, rolloutPercentage: 25, updatedBy: checker.user.id });
    const [applied] = await auditFor(flag.id, "flag.change_applied");
    expect(applied?.actorUserId).toBe(checker.user.id);
    expect(applied?.before).toEqual({ environment: "prod", enabled: false, rolloutPercentage: 0 });
    expect(applied?.after).toMatchObject({ environment: "prod", enabled: true, rolloutPercentage: 25, changeId: change.id });
  });

  it("rejects approval when the approver is the requester", async () => {
    const flag = await newFlag();
    const both = await senior();
    const { flag: view } = await changeFlag(both, await input(flag.id, "prod", { enabled: true, rolloutPercentage: 5 }));
    const change = view.pendingChange!;
    await expect(approveFlagChange(both, { changeId: change.id, expectedVersion: change.approval.version })).rejects.toThrow(
      SelfApprovalError,
    );
    expect(await valueOf(flag.id, "prod")).toMatchObject(OFF);
    // positive control: a different approver can approve the same change
    await approveFlagChange(await approver(), { changeId: change.id, expectedVersion: change.approval.version });
    expect(await valueOf(flag.id, "prod")).toMatchObject({ enabled: true, rolloutPercentage: 5 });
  });

  it("rejects approval by a user without flags:approve", async () => {
    const { flag, change } = await pendingProdChange();
    await expect(approveFlagChange(await analyst(), { changeId: change.id, expectedVersion: change.approval.version })).rejects.toThrow(
      ForbiddenError,
    );
    expect(await valueOf(flag.id, "prod")).toMatchObject(OFF);
  });

  it("a rejection leaves prod unchanged, marks the change rejected and audits it", async () => {
    const { flag, change } = await pendingProdChange();
    const decided = await rejectFlagChange(await approver(), {
      changeId: change.id,
      expectedVersion: change.approval.version,
      note: "Not during the freeze",
    });
    expect(decided.status).toBe("rejected");
    expect(await valueOf(flag.id, "prod")).toMatchObject(OFF);
    expect(await auditFor(flag.id, "flag.change_rejected")).toHaveLength(1);
    expect((await getFlagView(db, flag.id))?.pendingChange).toBeNull();
  });

  it("the database refuses to change a decided change", async () => {
    const { change } = await pendingProdChange();
    await rejectFlagChange(await approver(), { changeId: change.id, expectedVersion: change.approval.version, note: "No" });
    await expectDbError(db.update(flagChanges).set({ status: "applied", decidedAt: new Date() }).where(eq(flagChanges.id, change.id)), /already rejected/);
  });

  it("approving twice applies the change once", async () => {
    const { flag, change } = await pendingProdChange();
    const checker = await approver();
    await approveFlagChange(checker, { changeId: change.id, expectedVersion: change.approval.version });
    await expect(approveFlagChange(checker, { changeId: change.id, expectedVersion: change.approval.version })).rejects.toThrow(
      ConflictError,
    );
    expect(await auditFor(flag.id, "flag.change_applied")).toHaveLength(1);
    expect((await valueOf(flag.id, "prod")).version).toBe(2);
  });

  it("resubmitting an approved prod request reports it applied and creates nothing new", async () => {
    const flag = await newFlag();
    const maker = await analyst();
    const req = await input(flag.id, "prod", { enabled: true, rolloutPercentage: 15 });
    const change = (await changeFlag(maker, req)).flag.pendingChange;
    if (!change) throw new Error("expected a pending change");
    await approveFlagChange(await approver(), { changeId: change.id, expectedVersion: change.approval.version });
    expect((await changeFlag(maker, req)).outcome).toBe("applied");
    expect(await changesFor(flag.id)).toHaveLength(1);
  });

  it("resubmitting an approved prod request after prod moved on doesn't claim the old value is live", async () => {
    const flag = await newFlag();
    const maker = await analyst();
    const req = await input(flag.id, "prod", { enabled: true, rolloutPercentage: 15 });
    const change = (await changeFlag(maker, req)).flag.pendingChange;
    if (!change) throw new Error("expected a pending change");
    await approveFlagChange(await approver(), { changeId: change.id, expectedVersion: change.approval.version });
    await killFlag(maker, { flagId: flag.id, reason: "Incident" });
    await expect(changeFlag(maker, req)).rejects.toThrow(/prod has changed since/);
    expect(await valueOf(flag.id, "prod")).toMatchObject({ enabled: false, rolloutPercentage: 15 });
    expect(await changesFor(flag.id)).toHaveLength(1);
  });

  it("resubmitting a rejected prod request says it was rejected and creates nothing new", async () => {
    const flag = await newFlag();
    const maker = await analyst();
    const req = await input(flag.id, "prod", { enabled: true, rolloutPercentage: 15 });
    const change = (await changeFlag(maker, req)).flag.pendingChange;
    if (!change) throw new Error("expected a pending change");
    await rejectFlagChange(await approver(), { changeId: change.id, expectedVersion: change.approval.version, note: "Not now" });
    await expect(changeFlag(maker, req)).rejects.toThrow(/rejected/);
    expect(await changesFor(flag.id)).toHaveLength(1);
  });

  it("allows one pending prod change per flag, and a new one once it is decided", async () => {
    const { flag, change } = await pendingProdChange();
    const maker = await analyst();
    await expect(changeFlag(maker, await input(flag.id, "prod", { enabled: true, rolloutPercentage: 60 }))).rejects.toThrow(ConflictError);
    await rejectFlagChange(await approver(), { changeId: change.id, expectedVersion: change.approval.version, note: "Too much" });
    // positive control: once the first is decided, a new request is accepted
    const { outcome } = await changeFlag(maker, await input(flag.id, "prod", { enabled: true, rolloutPercentage: 60 }));
    expect(outcome).toBe("pending_approval");
  });

  it("a double-submitted prod request creates one change", async () => {
    const flag = await newFlag();
    const maker = await analyst();
    const req = await input(flag.id, "prod", { enabled: true, rolloutPercentage: 15 });
    const [a, b] = await Promise.all([changeFlag(maker, req), changeFlag(maker, req)]);
    expect(a.flag.pendingChange?.id).toBe(req.changeId);
    expect(b.flag.pendingChange?.id).toBe(req.changeId);
    expect(await changesFor(flag.id)).toHaveLength(1);
    expect(await auditFor(flag.id, "flag.change_requested")).toHaveLength(1);
  });

  it("refuses to approve a change after prod moved, so an old request can't overwrite a newer value", async () => {
    const { flag, change } = await pendingProdChange({ enabled: true, rolloutPercentage: 80 }, { prod: { enabled: true, rolloutPercentage: 10 } });
    await changeFlag(await analyst(), await input(flag.id, "prod", { enabled: false, rolloutPercentage: 10 }, { reason: "Incident" }));
    await expect(approveFlagChange(await approver(), { changeId: change.id, expectedVersion: change.approval.version })).rejects.toThrow(
      ConflictError,
    );
    expect(await valueOf(flag.id, "prod")).toMatchObject({ enabled: false, rolloutPercentage: 10 });
    // positive control: the stale change can still be rejected to clear it
    const rejected = await rejectFlagChange(await approver(), { changeId: change.id, expectedVersion: change.approval.version, note: "Stale" });
    expect(rejected.status).toBe("rejected");
  });

  it("lists pending prod changes for approvers until they are decided", async () => {
    const { change } = await pendingProdChange();
    const checker = await approver();
    expect((await listPendingFlagChanges(checker)).map((c) => c.id)).toContain(change.id);
    await approveFlagChange(checker, { changeId: change.id, expectedVersion: change.approval.version });
    expect((await listPendingFlagChanges(checker)).map((c) => c.id)).not.toContain(change.id);
  });

  it("filters the approvals queue by flag key", async () => {
    const { flag } = await pendingProdChange();
    const { flag: other } = await pendingProdChange();
    const ids = (await listPendingFlagChanges(await approver(), { q: flag.key.toUpperCase() })).map((c) => c.flagId);
    expect(ids).toContain(flag.id);
    expect(ids).not.toContain(other.id);
    expect((await listPendingFlagChanges(await approver())).map((c) => c.flagId)).toEqual(expect.arrayContaining([flag.id, other.id]));
  });

  it("an analyst can't open the prod approvals queue", async () => {
    await expect(listPendingFlagChanges(await analyst())).rejects.toThrow(ForbiddenError);
  });
});

describe("rule 4: turning a flag off in prod is an immediate, audited kill switch", () => {
  it("turns prod off at once without an approval request and audits it", async () => {
    const flag = await newFlag({ prod: { enabled: true, rolloutPercentage: 40 } });
    const maker = await analyst();
    const { outcome } = await changeFlag(maker, await input(flag.id, "prod", { enabled: false, rolloutPercentage: 40 }, { reason: "Errors spiking" }));
    expect(outcome).toBe("killed");
    expect(await valueOf(flag.id, "prod")).toMatchObject({ enabled: false, rolloutPercentage: 40 });
    expect(await changesFor(flag.id)).toHaveLength(0);
    const [row] = await auditFor(flag.id, "flag.killed");
    expect(row).toMatchObject({ actorUserId: maker.user.id, reason: "Errors spiking" });
    expect(row?.before).toEqual({ environment: "prod", enabled: true, rolloutPercentage: 40 });
    expect(row?.after).toMatchObject({ environment: "prod", enabled: false, rolloutPercentage: 40 });
  });

  it("works even when the page's version is out of date", async () => {
    const flag = await newFlag({ prod: { enabled: true, rolloutPercentage: 40 } });
    const kill = await input(flag.id, "prod", { enabled: false, rolloutPercentage: 40 }, { expectedVersion: 0 });
    expect((await changeFlag(await analyst(), kill)).outcome).toBe("killed");
    expect((await valueOf(flag.id, "prod")).enabled).toBe(false);
  });

  it("the kill switch button turns prod off whatever rollout the page showed", async () => {
    const flag = await newFlag({ prod: { enabled: true, rolloutPercentage: 40 } });
    const view = await killFlag(await analyst(), { flagId: flag.id, reason: "Incident" });
    expect(view.values.prod).toMatchObject({ enabled: false, rolloutPercentage: 40 });
    expect(await auditFor(flag.id, "flag.killed")).toHaveLength(1);
    await expect(killFlag(await analyst(), { flagId: flag.id, reason: "Again" })).rejects.toThrow(ConflictError);
    await expect(killFlag(await approver(), { flagId: flag.id, reason: "Not mine" })).rejects.toThrow(ForbiddenError);
  });

  it("still needs a reason", async () => {
    const flag = await newFlag({ prod: { enabled: true, rolloutPercentage: 40 } });
    await expect(
      changeFlag(await analyst(), await input(flag.id, "prod", { enabled: false, rolloutPercentage: 40 }, { reason: "" })),
    ).rejects.toThrow(ValidationError);
    expect((await valueOf(flag.id, "prod")).enabled).toBe(true);
  });

  it("turning off while also changing the rollout still needs approval", async () => {
    const flag = await newFlag({ prod: { enabled: true, rolloutPercentage: 40 } });
    const { outcome } = await changeFlag(await analyst(), await input(flag.id, "prod", { enabled: false, rolloutPercentage: 0 }));
    expect(outcome).toBe("pending_approval");
    expect((await valueOf(flag.id, "prod")).enabled).toBe(true);
  });

  it("works while a prod change is pending", async () => {
    const { flag } = await pendingProdChange({ enabled: true, rolloutPercentage: 90 }, { prod: { enabled: true, rolloutPercentage: 10 } });
    const { outcome } = await changeFlag(await analyst(), await input(flag.id, "prod", { enabled: false, rolloutPercentage: 10 }));
    expect(outcome).toBe("killed");
    expect((await valueOf(flag.id, "prod")).enabled).toBe(false);
  });

  it("denies the kill switch to a user without flags:request and audits the denial", async () => {
    const flag = await newFlag({ prod: { enabled: true, rolloutPercentage: 40 } });
    const checker = await approver();
    await expect(changeFlag(checker, await input(flag.id, "prod", { enabled: false, rolloutPercentage: 40 }))).rejects.toThrow(ForbiddenError);
    expect((await valueOf(flag.id, "prod")).enabled).toBe(true);
    const denied = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.actorUserId, checker.user.id), eq(auditLog.action, "access.denied")));
    expect(denied).toHaveLength(1);
  });
});

describe("rule 5: rollout percentage is a whole number from 0 to 100", () => {
  it.each([101, -1, 12.5, Number.NaN, Number.POSITIVE_INFINITY])("rejects %s and writes nothing", async (rolloutPercentage) => {
    const flag = await newFlag();
    await expect(changeFlag(await analyst(), await input(flag.id, "dev", { enabled: true, rolloutPercentage }))).rejects.toThrow(
      ValidationError,
    );
    expect(await valueOf(flag.id, "dev")).toMatchObject(OFF);
  });

  it.each([0, 100])("accepts %s (positive control)", async (rolloutPercentage) => {
    const flag = await newFlag();
    await changeFlag(await analyst(), await input(flag.id, "dev", { enabled: true, rolloutPercentage }));
    expect(await valueOf(flag.id, "dev")).toMatchObject({ enabled: true, rolloutPercentage });
  });

  it("rejects an out-of-range prod request before asking for approval", async () => {
    const flag = await newFlag();
    await expect(changeFlag(await analyst(), await input(flag.id, "prod", { enabled: true, rolloutPercentage: 150 }))).rejects.toThrow(
      ValidationError,
    );
    expect(await changesFor(flag.id)).toHaveLength(0);
  });

  it("parses form input strictly", () => {
    for (const raw of ["", "abc", "50%", "12.5", "1e2", "-0", "101", " 7 7"]) expect(() => parseRolloutPercentage(raw), raw).toThrow(ValidationError);
    expect(parseRolloutPercentage("0")).toBe(0);
    expect(parseRolloutPercentage(" 25 ")).toBe(25);
    expect(parseRolloutPercentage("100")).toBe(100);
  });

  it("the database rejects a rollout above 100", async () => {
    const flag = await newFlag();
    await expectDbError(
      db
        .update(flagValues)
        .set({ rolloutPercentage: 101, version: 2 })
        .where(and(eq(flagValues.flagId, flag.id), eq(flagValues.environment, "dev"))),
      /flag_values_rollout_range/,
    );
  });
});

describe("rule 6: every flag has a change history with before and after values", () => {
  // Within one transaction core writes the approval row after the app's hook, so it sorts first.
  it("lists dev changes, prod requests, decisions and kills newest first", async () => {
    const { flag, change } = await pendingProdChange();
    const maker = await analyst();
    await changeFlag(maker, await input(flag.id, "dev", { enabled: true, rolloutPercentage: 100 }));
    await approveFlagChange(await approver(), { changeId: change.id, expectedVersion: change.approval.version });
    await changeFlag(maker, await input(flag.id, "prod", { enabled: false, rolloutPercentage: 25 }, { reason: "Kill it" }));
    const history = await flagHistory(db, flag.id);
    expect(history.map((h) => h.action)).toEqual([
      "flag.killed",
      "approval.approved",
      "flag.change_applied",
      "flag.value_changed",
      "approval.requested",
      "flag.change_requested",
    ]);
  });

  it("each flag change in the history describes its before and after values", async () => {
    const flag = await newFlag({ staging: { enabled: true, rolloutPercentage: 10 } });
    await changeFlag(await analyst(), await input(flag.id, "staging", { enabled: true, rolloutPercentage: 35 }));
    const [entry] = await flagHistory(db, flag.id);
    expect(describeFlagAudit(entry?.after)).toBe("staging: On · 10% → On · 35%");
  });

  it("a rejected request shows what was asked for", async () => {
    const { flag, change } = await pendingProdChange({ enabled: true, rolloutPercentage: 20 });
    await rejectFlagChange(await approver(), { changeId: change.id, expectedVersion: change.approval.version, note: "No" });
    const rejected = (await flagHistory(db, flag.id)).find((h) => h.action === "flag.change_rejected");
    expect(describeFlagAudit(rejected?.after)).toBe("prod: Off · 0% → On · 20%");
  });

  it("returns an empty history for an unknown or malformed flag id", async () => {
    expect(await flagHistory(db, randomUUID())).toEqual([]);
    expect(await flagHistory(db, "not-a-uuid")).toEqual([]);
  });
});

describe("rule 7: services read current values from a read-only endpoint", () => {
  const config = { serviceToken: TOKEN };

  it("returns every flag's current value for the environment with a valid token", async () => {
    const flag = await newFlag({ prod: { enabled: true, rolloutPercentage: 30 } });
    const res = await handleFlagsServiceRequest(db, serviceRequest("?environment=prod"), config);
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("no-store");
    const body = (await res.json()) as { environment: string; flags: { key: string; enabled: boolean; rolloutPercentage: number }[] };
    expect(body.environment).toBe("prod");
    expect(body.flags.find((f) => f.key === flag.key)).toEqual({ key: flag.key, enabled: true, rolloutPercentage: 30 });
  });

  it("refuses a missing or wrong token", async () => {
    for (const token of [null, "wrong-token-0123456789abc", `${TOKEN}x`, ""]) {
      const res = await handleFlagsServiceRequest(db, serviceRequest("?environment=prod", token), config);
      expect(res.status, String(token)).toBe(401);
    }
    // positive control: the right token is accepted
    expect((await handleFlagsServiceRequest(db, serviceRequest("?environment=prod"), config)).status).toBe(200);
  });

  it("is switched off (503) when no token is configured, even for a request that sends one", async () => {
    const res = await handleFlagsServiceRequest(db, serviceRequest("?environment=prod"), { serviceToken: null });
    expect(res.status).toBe(503);
  });

  it("rejects a missing or unknown environment", async () => {
    for (const q of ["", "?environment=qa", "?environment=PROD"]) {
      expect((await handleFlagsServiceRequest(db, serviceRequest(q), config)).status, q).toBe(400);
    }
    expect((await handleFlagsServiceRequest(db, serviceRequest("?environment=dev"), config)).status).toBe(200);
  });

  it("refuses anything but GET, and the route exports GET only", async () => {
    expect((await handleFlagsServiceRequest(db, serviceRequest("?environment=prod", TOKEN, "POST"), config)).status).toBe(405);
    const route = readFileSync(new URL("../app/api/flags/route.ts", import.meta.url), "utf8");
    expect([...route.matchAll(/export\s+(?:const|async function|function)\s+(\w+)/g)].map((m) => m[1])).toEqual(["GET"]);
  });

  it("reflects a kill switch on the next read", async () => {
    const flag = await newFlag({ prod: { enabled: true, rolloutPercentage: 30 } });
    await changeFlag(await analyst(), await input(flag.id, "prod", { enabled: false, rolloutPercentage: 30 }, { reason: "Incident" }));
    const values = await serviceFlagValues(db, "prod");
    expect(values.flags.find((f) => f.key === flag.key)).toEqual({ key: flag.key, enabled: false, rolloutPercentage: 30 });
  });

  it("does not show a pending prod change until it is approved", async () => {
    const { flag } = await pendingProdChange();
    const values = await serviceFlagValues(db, "prod");
    expect(values.flags.find((f) => f.key === flag.key)).toEqual({ key: flag.key, ...OFF });
  });

  it("reads FLAGS_SERVICE_TOKEN, is off when unset, and rejects short tokens", () => {
    expect(loadFlagsServiceConfig({})).toEqual({ serviceToken: null });
    expect(loadFlagsServiceConfig({ FLAGS_SERVICE_TOKEN: "  " })).toEqual({ serviceToken: null });
    expect(loadFlagsServiceConfig({ FLAGS_SERVICE_TOKEN: TOKEN })).toEqual({ serviceToken: TOKEN });
    expect(() => loadFlagsServiceConfig({ FLAGS_SERVICE_TOKEN: "short" })).toThrow(/at least 16/);
  });
});
