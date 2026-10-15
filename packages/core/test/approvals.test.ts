import { and, eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { approvalRequests, auditLog, createDb, users } from "@fit/db";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  SelfApprovalError,
  ValidationError,
  cancelApproval,
  decideApproval,
  defineApprovalKind,
  requestApproval,
} from "../src/index.ts";
import { appDb, expectDbError, makeUser, uniqueId } from "./helpers/db.ts";
import { TEST_DATABASE_URL } from "./helpers/env.ts";

const db = appDb();

const payoutKind = defineApprovalKind<{ iban: string }>({
  kind: "test.payout",
  subjectType: "test_subject",
  requestPermission: "approvals:request",
  approvePermission: "approvals:decide",
});
const otherKind = defineApprovalKind<{ iban: string }>({
  kind: "test.other",
  subjectType: "test_subject",
  requestPermission: "approvals:request",
  approvePermission: "approvals:decide",
});

const IBAN = "GB00TEST12345678";

const analyst = () => makeUser(db, ["analyst"]);
const approver = () => makeUser(db, ["approver"]);

async function newRequest(payload: { iban: string } = { iban: IBAN }) {
  const { user: requester } = await analyst();
  const subjectId = uniqueId("payout");
  const request = await requestApproval(db, requester, payoutKind, { subjectId, payload });
  return { request, requester, subjectId };
}

function requestRow(id: string) {
  return db.select().from(approvalRequests).where(eq(approvalRequests.id, id)).then((r) => r[0] ?? null);
}
function auditRows(entityId: string, action?: string) {
  return db
    .select()
    .from(auditLog)
    .where(action ? and(eq(auditLog.entityId, entityId), eq(auditLog.action, action)) : eq(auditLog.entityId, entityId));
}
const deniedRows = (resource: string) => auditRows(resource, "access.denied");

describe("maker-checker approvals", () => {
  it("rejects approval when approver is the requester", async () => {
    // One user holding both roles is still not allowed to check their own work.
    const { user: both } = await makeUser(db, ["analyst", "approver"]);
    const subjectId = uniqueId("payout");
    const request = await requestApproval(db, both, payoutKind, { subjectId, payload: { iban: IBAN } });
    await expect(
      decideApproval(db, both, payoutKind, { id: request.id, decision: "approve", expectedVersion: 1 }),
    ).rejects.toThrow(SelfApprovalError);
    const row = await requestRow(request.id);
    expect(row).toMatchObject({ status: "pending", version: 1, decidedBy: null, decidedAt: null });
    const denied = await deniedRows(`approval:${request.id}`);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ actorUserId: both.id, metadata: { required: "approval:not-requester", roles: both.roles } });
  });

  it("allows approval by a different approver", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    const decided = await decideApproval(db, dec, payoutKind, {
      id: request.id,
      decision: "approve",
      expectedVersion: 1,
    });
    expect(decided).toMatchObject({ status: "approved", decidedBy: dec.id, version: 2 });
    expect(decided.decidedAt).toBeInstanceOf(Date);
    expect((await requestRow(request.id))).toMatchObject({ status: "approved", decidedBy: dec.id, version: 2 });
  });

  it("database rejects a decision where decided_by equals requested_by", async () => {
    const { request } = await newRequest();
    await expectDbError(
      db.execute(
        sql`update approval_requests set status = 'approved', decided_by = requested_by, decided_at = now(), version = version + 1 where id = ${request.id}`,
      ),
      /maker_is_not_checker/,
    );
  });

  it("database accepts the same decision by a different user", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    await db.execute(
      sql`update approval_requests set status = 'approved', decided_by = ${dec.id}, decided_at = now(), version = version + 1 where id = ${request.id}`,
    );
    expect((await requestRow(request.id))).toMatchObject({ status: "approved", decidedBy: dec.id });
  });

  it("rejects a decision by a user without the approve permission", async () => {
    const { request } = await newRequest();
    const { user: noPerms } = await analyst();
    await expect(
      decideApproval(db, noPerms, payoutKind, { id: request.id, decision: "approve", expectedVersion: 1 }),
    ).rejects.toThrow(ForbiddenError);
    const denied = await deniedRows(`approval:${request.id}`);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ actorUserId: noPerms.id, metadata: { required: "permission:approvals:decide", roles: ["analyst"] } });
    expect((await requestRow(request.id))).toMatchObject({ status: "pending", version: 1 });
  });

  it("rejects a decision by an admin without the approve permission (no admin bypass)", async () => {
    const { request } = await newRequest();
    const { user: admin } = await makeUser(db, ["admin"]);
    await expect(
      decideApproval(db, admin, payoutKind, { id: request.id, decision: "approve", expectedVersion: 1 }),
    ).rejects.toThrow(ForbiddenError);
    expect((await requestRow(request.id))).toMatchObject({ status: "pending", version: 1 });
  });

  it("allows rejection with a note by an approver", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    const decided = await decideApproval(db, dec, payoutKind, {
      id: request.id,
      decision: "reject",
      note: "  wrong account  ",
      expectedVersion: 1,
    });
    expect(decided).toMatchObject({ status: "rejected", decidedBy: dec.id, decisionNote: "wrong account", version: 2 });
  });

  it("rejects a request from a user without the request permission", async () => {
    const { user: noPerms } = await approver();
    const subjectId = uniqueId("payout");
    await expect(
      requestApproval(db, noPerms, payoutKind, { subjectId, payload: { iban: IBAN } }),
    ).rejects.toThrow(ForbiddenError);
    const rows = await db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, subjectId));
    expect(rows).toHaveLength(0);
  });

  it("creates a pending request for a user with the request permission", async () => {
    const { request, requester, subjectId } = await newRequest();
    expect(request).toMatchObject({
      kind: "test.payout",
      subjectType: "test_subject",
      subjectId,
      status: "pending",
      version: 1,
      requestedBy: requester.id,
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
    });
    expect(request.payload).toEqual({ iban: IBAN });
    expect(request.requestedAt).toBeInstanceOf(Date);
  });

  it.each(["approved", "rejected", "cancelled"] as const)(
    "rejects deciding a request that is not pending (%s)",
    async (outcome) => {
      const { request, requester } = await newRequest();
      const { user: dec } = await approver();
      if (outcome === "cancelled") {
        await cancelApproval(db, requester, { id: request.id, note: "withdrawing it" });
      } else {
        await decideApproval(db, dec, payoutKind, {
          id: request.id,
          decision: outcome === "approved" ? "approve" : "reject",
          note: outcome === "rejected" ? "no" : undefined,
          expectedVersion: 1,
        });
      }
      await expect(
        decideApproval(db, dec, payoutKind, { id: request.id, decision: "approve", expectedVersion: 2 }),
      ).rejects.toThrow(ConflictError);
    },
  );

  it("rejects a decision with a stale expectedVersion", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    await expect(
      decideApproval(db, dec, payoutKind, { id: request.id, decision: "approve", expectedVersion: 99 }),
    ).rejects.toThrow(ConflictError);
    expect((await requestRow(request.id))).toMatchObject({ status: "pending", version: 1 });
  });

  it("accepts a decision with the current expectedVersion", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    const decided = await decideApproval(db, dec, payoutKind, {
      id: request.id,
      decision: "approve",
      expectedVersion: request.version,
    });
    expect(decided.status).toBe("approved");
  });

  it("lets exactly one of two concurrent approvals win", async () => {
    const { request } = await newRequest();
    const pool = createDb(TEST_DATABASE_URL, { max: 4 });
    try {
      const { user: a } = await approver();
      const { user: b } = await approver();
      const results = await Promise.allSettled([
        decideApproval(pool, a, payoutKind, { id: request.id, decision: "approve", expectedVersion: 1 }),
        decideApproval(pool, b, payoutKind, { id: request.id, decision: "approve", expectedVersion: 1 }),
      ]);
      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");
      expect(fulfilled).toHaveLength(1);
      expect(rejected).toHaveLength(1);
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
      const row = await requestRow(request.id);
      expect(row).toMatchObject({ status: "approved", version: 2 });
      expect(await auditRows(request.id, "approval.approved")).toHaveLength(1);
    } finally {
      await pool.$client.end();
    }
  });

  it("rejects deciding a request that does not exist", async () => {
    const { user: dec } = await approver();
    await expect(
      decideApproval(db, dec, payoutKind, {
        id: "00000000-0000-4000-8000-000000000000",
        decision: "approve",
        expectedVersion: 1,
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it.each([
    { label: "Date", payload: () => ({ at: new Date() }) },
    // intentionally sparse: tests that the guard rejects holes
    { label: "sparse array", payload: () => ({ lines: [1, , 3] }) },
    {
      label: "circular",
      payload: () => {
        const circular: Record<string, unknown> = { a: 1 };
        circular.self = circular;
        return circular;
      },
    },
  ])("rejects a request whose payload is not JSON-safe ($label)", async ({ payload }) => {
    const { user: requester } = await analyst();
    const subjectId = uniqueId("payout");
    await expect(
      // `as never` bypasses the compile-time payload check to exercise the runtime one.
      requestApproval(db, requester, payoutKind, { subjectId, payload: payload() as never }),
    ).rejects.toThrow(ValidationError);
    const rows = await db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, subjectId));
    expect(rows).toHaveLength(0);
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "approval.requested"), eq(auditLog.actorUserId, requester.id)));
    expect(audits).toHaveLength(0);
  });

  it("accepts a payload that reuses the same object twice", async () => {
    const { user: requester } = await analyst();
    const line = { sku: "x", qty: 1 };
    const request = await requestApproval(db, requester, payoutKind, {
      subjectId: uniqueId("payout"),
      payload: { lines: [line, line] } as never,
    });
    expect(request.payload).toEqual({ lines: [{ sku: "x", qty: 1 }, { sku: "x", qty: 1 }] });
  });

  it("rejects deciding with a different kind's definition", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    await expect(
      decideApproval(db, dec, otherKind, { id: request.id, decision: "approve", expectedVersion: 1 }),
    ).rejects.toThrow(ValidationError);
    expect((await requestRow(request.id))).toMatchObject({ status: "pending", version: 1 });
  });
});

describe("approval audit rows", () => {
  it("writes an approval.requested audit row referencing the request id", async () => {
    const { request, requester } = await newRequest();
    const rows = await auditRows(request.id, "approval.requested");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: requester.id,
      actorSubject: requester.subject,
      entityType: "approval_request",
      entityId: request.id,
      after: { status: "pending", version: 1 },
      metadata: { kind: "test.payout", subjectType: "test_subject", subjectId: request.subjectId },
    });
    expect(JSON.stringify(rows[0])).not.toContain(IBAN);
  });

  it("writes an approval.approved audit row", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    await decideApproval(db, dec, payoutKind, { id: request.id, decision: "approve", expectedVersion: 1 });
    const rows = await auditRows(request.id, "approval.approved");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: dec.id,
      entityType: "approval_request",
      entityId: request.id,
      before: { status: "pending", version: 1 },
      after: { status: "approved", version: 2 },
      metadata: { kind: "test.payout", subjectType: "test_subject", subjectId: request.subjectId },
    });
    expect(JSON.stringify(rows[0])).not.toContain(IBAN);
  });

  it("writes an approval.rejected audit row", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    await decideApproval(db, dec, payoutKind, {
      id: request.id,
      decision: "reject",
      note: "  wrong account ",
      expectedVersion: 1,
    });
    const rows = await auditRows(request.id, "approval.rejected");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: dec.id,
      reason: "wrong account",
      before: { status: "pending", version: 1 },
      after: { status: "rejected", version: 2 },
    });
    expect(JSON.stringify(rows[0])).not.toContain(IBAN);
  });

  it("writes an approval.cancelled audit row", async () => {
    const { request, requester } = await newRequest();
    await cancelApproval(db, requester, { id: request.id, note: "  no longer needed " });
    const rows = await auditRows(request.id, "approval.cancelled");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: requester.id,
      reason: "no longer needed",
      before: { status: "pending", version: 1 },
      after: { status: "cancelled", version: 2 },
    });
    expect(JSON.stringify(rows[0])).not.toContain(IBAN);
  });
});

describe("approval hooks", () => {
  it("rolls back the request, the app record and the audit row when onRequested throws", async () => {
    const { user: requester } = await analyst();
    const { user: target } = await makeUser(db, ["analyst"]);
    const subjectId = uniqueId("payout");
    const kind = defineApprovalKind<{ iban: string }>({
      ...payoutKind,
      onRequested: async (tx) => {
        await tx.update(users).set({ displayName: "x" }).where(eq(users.id, target.id));
        throw new Error("downstream write failed");
      },
    });
    await expect(
      requestApproval(db, requester, kind, { subjectId, payload: { iban: IBAN } }),
    ).rejects.toThrow("downstream write failed");
    const rows = await db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, subjectId));
    expect(rows).toHaveLength(0);
    // requester is a fresh user in this test, so filtering by actor id is enough.
    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, "approval.requested"), eq(auditLog.actorUserId, requester.id)));
    expect(audits).toHaveLength(0);
    const [t] = await db.select({ n: users.displayName }).from(users).where(eq(users.id, target.id));
    expect(t).toBeDefined();
    expect(t?.n).not.toBe("x");
  });

  it("commits the app record with the request when onRequested succeeds", async () => {
    const { user: requester } = await analyst();
    const { user: target } = await makeUser(db, ["analyst"]);
    const subjectId = uniqueId("payout");
    const kind = defineApprovalKind<{ iban: string }>({
      ...payoutKind,
      onRequested: async (tx, request) => {
        await tx.update(users).set({ displayName: `record-for-${request.id}` }).where(eq(users.id, target.id));
      },
    });
    const request = await requestApproval(db, requester, kind, { subjectId, payload: { iban: IBAN } });
    const [t] = await db.select({ n: users.displayName }).from(users).where(eq(users.id, target.id));
    expect(t?.n).toBe(`record-for-${request.id}`);
    const audits = await auditRows(request.id, "approval.requested");
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({ entityId: request.id });
  });

  it("rolls back the decision and its audit row when onApproved throws", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    const { user: target } = await makeUser(db, ["analyst"]);
    const kind = defineApprovalKind<{ iban: string }>({
      ...payoutKind,
      onApproved: async (tx) => {
        await tx.update(users).set({ displayName: "approved-effect" }).where(eq(users.id, target.id));
        throw new Error("effect failed");
      },
    });
    await expect(
      decideApproval(db, dec, kind, { id: request.id, decision: "approve", expectedVersion: 1 }),
    ).rejects.toThrow("effect failed");
    expect((await requestRow(request.id))).toMatchObject({ status: "pending", version: 1 });
    expect(await auditRows(request.id, "approval.approved")).toHaveLength(0);
    const [t] = await db.select({ n: users.displayName }).from(users).where(eq(users.id, target.id));
    expect(t).toBeDefined();
    expect(t?.n).not.toBe("approved-effect");
  });

  it("passes hooks the payload exactly as requested", async () => {
    const { user: requester } = await analyst();
    const { user: dec } = await approver();
    const payload = { amount: 1250, currency: "GBP", lines: [{ sku: "x", qty: 2 }], note: null };
    let seenRequested: unknown;
    let seenApproved: unknown;
    const kind = defineApprovalKind<typeof payload>({
      kind: "test.payload",
      subjectType: "test_subject",
      requestPermission: "approvals:request",
      approvePermission: "approvals:decide",
      onRequested: async (_tx, req) => {
        seenRequested = req.payload;
      },
      onApproved: async (_tx, req) => {
        seenApproved = req.payload;
      },
    });
    const request = await requestApproval(db, requester, kind, { subjectId: uniqueId("payout"), payload });
    await decideApproval(db, dec, kind, { id: request.id, decision: "approve", expectedVersion: 1 });
    expect(seenRequested).toEqual(payload);
    expect(seenApproved).toEqual(payload);
    expect(request.payload).toEqual(payload);
  });

  it("commits the onRejected effect with the rejection", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    const { user: target } = await makeUser(db, ["analyst"]);
    let seen: unknown;
    const kind = defineApprovalKind<{ iban: string }>({
      ...payoutKind,
      onRejected: async (tx, req) => {
        seen = req;
        await tx.update(users).set({ displayName: `rejected-${req.id}` }).where(eq(users.id, target.id));
      },
    });
    const decided = await decideApproval(db, dec, kind, {
      id: request.id,
      decision: "reject",
      note: "wrong account",
      expectedVersion: 1,
    });
    expect(decided.status).toBe("rejected");
    const [t] = await db.select({ n: users.displayName }).from(users).where(eq(users.id, target.id));
    expect(t?.n).toBe(`rejected-${request.id}`);
    expect(seen).toMatchObject({ status: "rejected", decidedBy: dec.id, decisionNote: "wrong account", version: 2 });
  });

  it("rolls back the rejection and its audit row when onRejected throws", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    const { user: target } = await makeUser(db, ["analyst"]);
    const kind = defineApprovalKind<{ iban: string }>({
      ...payoutKind,
      onRejected: async (tx) => {
        await tx.update(users).set({ displayName: "rejected-effect" }).where(eq(users.id, target.id));
        throw new Error("effect failed");
      },
    });
    await expect(
      decideApproval(db, dec, kind, { id: request.id, decision: "reject", note: "wrong account", expectedVersion: 1 }),
    ).rejects.toThrow("effect failed");
    expect((await requestRow(request.id))).toMatchObject({ status: "pending", version: 1 });
    expect(await auditRows(request.id, "approval.rejected")).toHaveLength(0);
    const [t] = await db.select({ n: users.displayName }).from(users).where(eq(users.id, target.id));
    expect(t).toBeDefined();
    expect(t?.n).not.toBe("rejected-effect");
  });

  it("does not call onRejected when a request is approved", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    let called = false;
    const kind = defineApprovalKind<{ iban: string }>({
      ...payoutKind,
      onRejected: async () => {
        called = true;
      },
    });
    await decideApproval(db, dec, kind, { id: request.id, decision: "approve", expectedVersion: 1 });
    expect(called).toBe(false);
  });

  it("does not call onApproved when a request is rejected", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    let called = false;
    const kind = defineApprovalKind<{ iban: string }>({
      ...payoutKind,
      onApproved: async () => {
        called = true;
      },
    });
    await decideApproval(db, dec, kind, { id: request.id, decision: "reject", note: "wrong account", expectedVersion: 1 });
    expect(called).toBe(false);
  });

  it("does not call onRejected when a request is cancelled", async () => {
    const { request, requester } = await newRequest();
    let called = false;
    const _kind = defineApprovalKind<{ iban: string }>({
      ...payoutKind,
      onRejected: async () => {
        called = true;
      },
    });
    await cancelApproval(db, requester, { id: request.id, note: "withdrawing it" });
    expect(called).toBe(false);
  });

  it("commits the onApproved effect with the decision", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    const { user: target } = await makeUser(db, ["analyst"]);
    const kind = defineApprovalKind<{ iban: string }>({
      ...payoutKind,
      onApproved: async (tx, req) => {
        await tx.update(users).set({ displayName: `approved-${req.id}` }).where(eq(users.id, target.id));
      },
    });
    const decided = await decideApproval(db, dec, kind, { id: request.id, decision: "approve", expectedVersion: 1 });
    expect(decided.status).toBe("approved");
    const [t] = await db.select({ n: users.displayName }).from(users).where(eq(users.id, target.id));
    expect(t?.n).toBe(`approved-${request.id}`);
  });
});

describe("approval notes and cancellation", () => {
  it("rejects a decision that is neither approve nor reject", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    await expect(
      // Untrusted input can carry a non-literal decision past the type.
      decideApproval(db, dec, payoutKind, {
        id: request.id,
        decision: "REJECT" as never,
        expectedVersion: 1,
      }),
    ).rejects.toThrow(ValidationError);
    expect((await requestRow(request.id))).toMatchObject({ status: "pending", version: 1 });
    expect(await auditRows(request.id, "approval.rejected")).toHaveLength(0);
  });

  it.each([undefined, "   "])("rejects a rejection without a note (%j)", async (note) => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    await expect(
      decideApproval(db, dec, payoutKind, { id: request.id, decision: "reject", note, expectedVersion: 1 }),
    ).rejects.toThrow(ValidationError);
    expect((await requestRow(request.id))).toMatchObject({ status: "pending", version: 1 });
  });

  it("rejects cancel by someone other than the requester", async () => {
    const { request } = await newRequest();
    const { user: other } = await approver();
    await expect(cancelApproval(db, other, { id: request.id, note: "not mine" })).rejects.toThrow(ForbiddenError);
    const denied = await deniedRows(`approval:${request.id}`);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ actorUserId: other.id, metadata: { required: "approval:requester-only", roles: ["approver"] } });
    expect((await requestRow(request.id))).toMatchObject({ status: "pending", version: 1 });
  });

  it("lets the requester cancel a pending request", async () => {
    const { request, requester } = await newRequest();
    const cancelled = await cancelApproval(db, requester, { id: request.id, note: "withdrawing it" });
    expect(cancelled).toMatchObject({ status: "cancelled", decidedBy: null, decisionNote: "withdrawing it", version: 2 });
    expect(cancelled.decidedAt).toBeInstanceOf(Date);
    expect((await requestRow(request.id))).toMatchObject({ status: "cancelled", decidedBy: null, version: 2 });
  });

  it.each(["", "   "])("rejects a cancel without a note (%j)", async (note) => {
    const { request, requester } = await newRequest();
    await expect(cancelApproval(db, requester, { id: request.id, note })).rejects.toThrow(ValidationError);
    expect((await requestRow(request.id))).toMatchObject({ status: "pending", version: 1 });
  });

  it("rejects cancelling a request that is not pending", async () => {
    const { request, requester } = await newRequest();
    const { user: dec } = await approver();
    await decideApproval(db, dec, payoutKind, { id: request.id, decision: "approve", expectedVersion: 1 });
    await expect(cancelApproval(db, requester, { id: request.id, note: "too late" })).rejects.toThrow(ConflictError);
  });
});

describe("approval_requests database guards", () => {
  it("database rejects updating a decided request", async () => {
    const { request } = await newRequest();
    const { user: dec } = await approver();
    await decideApproval(db, dec, payoutKind, { id: request.id, decision: "approve", expectedVersion: 1 });
    await expectDbError(
      db.execute(sql`update approval_requests set decision_note = 'changed' where id = ${request.id}`),
      /already approved/,
    );
  });

  it("database rejects changing a pending request's requester or payload", async () => {
    const { request: a } = await newRequest();
    const { user: other } = await approver();
    await expectDbError(
      db.execute(sql`update approval_requests set requested_by = ${other.id} where id = ${a.id}`),
      /immutable/,
    );
    const { request: b } = await newRequest();
    await expectDbError(
      db.execute(sql`update approval_requests set payload = '{"iban":"XX"}'::jsonb where id = ${b.id}`),
      /immutable/,
    );
  });

  it("database rejects inserting a request that is not pending", async () => {
    const { user: requester } = await analyst();
    const { user: dec } = await approver();
    await expectDbError(
      db.execute(sql`insert into approval_requests
        (kind, subject_type, subject_id, payload, status, requested_by, decided_by, decided_at)
        values ('test.payout', 'test_subject', ${uniqueId("payout")}, '{}'::jsonb, 'approved', ${requester.id}, ${dec.id}, now())`),
      /must start pending/,
    );
  });

  it("app role cannot delete approval requests", async () => {
    const { request } = await newRequest();
    await expectDbError(
      db.execute(sql`delete from approval_requests where id = ${request.id}`),
      /permission denied/,
    );
  });

  it("database accepts a pending insert and a pending→approved update", async () => {
    const { user: requester } = await analyst();
    const { user: dec } = await approver();
    const { rows } = await db.execute<{ id: string }>(sql`insert into approval_requests
      (kind, subject_type, subject_id, payload, requested_by)
      values ('test.payout', 'test_subject', ${uniqueId("payout")}, '{}'::jsonb, ${requester.id})
      returning id`);
    const id = rows[0]!.id;
    await db.execute(
      sql`update approval_requests set status = 'approved', decided_by = ${dec.id}, decided_at = now(), version = version + 1 where id = ${id}`,
    );
    expect((await requestRow(id))).toMatchObject({ status: "approved", decidedBy: dec.id, version: 2 });
  });
});
