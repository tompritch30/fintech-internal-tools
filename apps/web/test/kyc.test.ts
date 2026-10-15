import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";
import { ConflictError, ForbiddenError, SelfApprovalError, ValidationError, permissionsFor } from "@fit/core";
import { approvalRequests, auditLog, createDb, kycCases, kycDocuments, type KycCaseRow } from "@fit/db";
import { seedKycCases } from "@fit/db/seed";
import { expectDbError, makeUser, ownerDb } from "../../../packages/core/test/helpers/db.ts";
import { TEST_DATABASE_URL } from "../../../packages/core/test/helpers/env.ts";
import {
  caseHistory,
  claimCase,
  decideCase,
  getKycCase,
  isHighRisk,
  listKycCases,
  loadKycConfig,
  openCaseDocument,
  revealCaseField,
  signOffCase,
} from "../app/(platform)/kyc/kyc.ts";

// app_runtime, with enough connections for the concurrent-claim test.
const db = createDb(TEST_DATABASE_URL, { max: 6 });
afterAll(() => db.$client.end());
const owner = ownerDb();

const config = { retentionYears: 5 };

const as = async (roles: string[]) => ({ db, user: (await makeUser(db, roles)).user });
const analyst = () => as(["analyst"]);
const approver = () => as(["approver"]);

/** Cases and documents come from the seed role only (app_runtime can't insert them). */
async function newCase(flags: Partial<Pick<KycCaseRow, "riskRating" | "sanctionsHit" | "pep">> = {}) {
  const n = randomUUID().slice(0, 8);
  const [row] = await owner
    .insert(kycCases)
    .values({
      reference: `KYC-T-${n}`,
      applicantName: `Testapplicant Surname${n}`,
      dateOfBirth: "1971-11-23",
      idNumber: `TST-${n}`,
      address: `${n} Example Lane, Testford, ZZ1 1TT`,
      nationality: "GB",
      riskRating: "low",
      ...flags,
    })
    .returning();
  if (!row) throw new Error("case insert failed");
  const [doc] = await owner
    .insert(kycDocuments)
    .values({ caseId: row.id, kind: "passport", fileName: "passport.pdf", content: `SYNTHETIC passport for ${n}` })
    .returning();
  if (!doc) throw new Error("document insert failed");
  return { kase: row, doc };
}

const highRisk = () => newCase({ riskRating: "high", pep: true });

const caseRow = async (id: string) => (await db.select().from(kycCases).where(eq(kycCases.id, id)))[0];
const auditFor = (entityId: string, action?: string) =>
  db
    .select()
    .from(auditLog)
    .where(action ? and(eq(auditLog.entityId, entityId), eq(auditLog.action, action)) : eq(auditLog.entityId, entityId));
const deniedFor = (caseId: string) => auditFor(`kyc_case:${caseId}`, "access.denied");

/** A claimed high-risk case whose approve decision is waiting for sign-off. */
async function pendingSignOff() {
  const { kase } = await highRisk();
  const maker = await analyst();
  await claimCase(maker, { caseId: kase.id });
  const view = await decideCase(maker, { caseId: kase.id, decision: "approve" }, config);
  return { kase, maker, view };
}

const piiOf = (k: KycCaseRow) => [k.applicantName, k.dateOfBirth, k.idNumber, k.address];

describe("kyc permissions come from the registry", () => {
  it("analysts claim and decide, approvers sign off, both read; admins get none", () => {
    expect([...permissionsFor(["analyst"])]).toEqual(expect.arrayContaining(["kyc:read", "kyc:request"]));
    expect([...permissionsFor(["approver"])]).toEqual(expect.arrayContaining(["kyc:read", "kyc:approve"]));
    expect(permissionsFor(["analyst"]).has("kyc:approve" as never)).toBe(false);
    expect(permissionsFor(["approver"]).has("kyc:request" as never)).toBe(false);
    expect([...permissionsFor(["admin"])].filter((p) => p.startsWith("kyc:"))).toEqual([]);
  });

  it("denies the queue to a user without kyc:read and writes access.denied", async () => {
    const admin = await as(["admin"]);
    await expect(listKycCases(admin, {})).rejects.toBeInstanceOf(ForbiddenError);
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.actorUserId, admin.user.id), eq(auditLog.action, "access.denied")));
    expect(rows).toHaveLength(1);
  });

  it("shows the queue to an analyst (positive control)", async () => {
    const { kase } = await newCase();
    const { rows } = await listKycCases(await analyst(), { search: kase.reference });
    expect(rows.map((r) => r.id)).toEqual([kase.id]);
  });
});

describe("rule 1: an analyst claims a case; only the owner can act on it", () => {
  it("claims an open case and audits the claim", async () => {
    const { kase } = await newCase();
    const a = await analyst();
    const view = await claimCase(a, { caseId: kase.id });
    expect(view).toMatchObject({ status: "in_review", ownerId: a.user.id });
    const [row] = await auditFor(kase.id, "kyc.claimed");
    expect(row).toMatchObject({ entityType: "kyc_case", actorUserId: a.user.id });
  });

  it("refuses to claim a case another analyst already owns", async () => {
    const { kase } = await newCase();
    const first = await analyst();
    await claimCase(first, { caseId: kase.id });
    await expect(claimCase(await analyst(), { caseId: kase.id })).rejects.toBeInstanceOf(ConflictError);
    expect((await caseRow(kase.id))?.ownerId).toBe(first.user.id);
  });

  it("lets exactly one of two concurrent claims win", async () => {
    const { kase } = await newCase();
    const [a, b] = await Promise.all([analyst(), analyst()]);
    const results = await Promise.allSettled([claimCase(a, { caseId: kase.id }), claimCase(b, { caseId: kase.id })]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const [lost] = results.filter((r) => r.status === "rejected");
    expect((lost as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
    expect(await auditFor(kase.id, "kyc.claimed")).toHaveLength(1);
  });

  it("denies a decision by an analyst who isn't the owner and writes access.denied", async () => {
    const { kase } = await newCase();
    await claimCase(await analyst(), { caseId: kase.id });
    const other = await analyst();
    await expect(decideCase(other, { caseId: kase.id, decision: "approve" }, config)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await caseRow(kase.id))?.status).toBe("in_review");
    const [denied] = await deniedFor(kase.id);
    expect(denied).toMatchObject({ actorUserId: other.user.id, metadata: expect.objectContaining({ required: "kyc:case-owner" }) });
  });

  it("lets the owner make the same decision (positive control)", async () => {
    const { kase } = await newCase();
    const owner = await analyst();
    await claimCase(owner, { caseId: kase.id });
    const view = await decideCase(owner, { caseId: kase.id, decision: "approve" }, config);
    expect(view.status).toBe("approved");
  });

  it("denies deciding an unclaimed case", async () => {
    const { kase } = await newCase();
    await expect(decideCase(await analyst(), { caseId: kase.id, decision: "approve" }, config)).rejects.toBeInstanceOf(ForbiddenError);
    expect((await caseRow(kase.id))?.status).toBe("open");
  });

  it("denies claiming to an approver (no kyc:request) and writes access.denied", async () => {
    const { kase } = await newCase();
    await expect(claimCase(await approver(), { caseId: kase.id })).rejects.toBeInstanceOf(ForbiddenError);
    expect((await caseRow(kase.id))?.ownerId).toBeNull();
    expect(await deniedFor(kase.id)).toHaveLength(1);
  });
});

describe("rule 2: approve, reject or escalate; reject and escalate need a note", () => {
  for (const decision of ["reject", "escalate"] as const) {
    it(`refuses to ${decision} without a note and writes nothing`, async () => {
      const { kase } = await newCase();
      const a = await analyst();
      await claimCase(a, { caseId: kase.id });
      await expect(decideCase(a, { caseId: kase.id, decision, note: "   " }, config)).rejects.toBeInstanceOf(ValidationError);
      expect((await caseRow(kase.id))?.status).toBe("in_review");
      expect(await auditFor(kase.id, `kyc.${decision === "reject" ? "rejected" : "escalated"}`)).toHaveLength(0);
    });
  }

  it("rejects with a note, closes the case and audits the note (positive control)", async () => {
    const { kase } = await newCase();
    const a = await analyst();
    await claimCase(a, { caseId: kase.id });
    const view = await decideCase(a, { caseId: kase.id, decision: "reject", note: "Document expired" }, config);
    expect(view).toMatchObject({ status: "rejected", decisionNote: "Document expired" });
    expect(view.closedAt).toBeInstanceOf(Date);
    const [row] = await auditFor(kase.id, "kyc.rejected");
    expect(row).toMatchObject({ reason: "Document expired" });
  });

  it("escalates with a note and releases the case for another analyst (positive control)", async () => {
    const { kase } = await newCase();
    const a = await analyst();
    await claimCase(a, { caseId: kase.id });
    const view = await decideCase(a, { caseId: kase.id, decision: "escalate", note: "Address mismatch, needs senior" }, config);
    expect(view).toMatchObject({ status: "escalated", ownerId: null });
    expect((await auditFor(kase.id, "kyc.escalated"))[0]).toMatchObject({ reason: "Address mismatch, needs senior" });
    const next = await analyst();
    expect((await claimCase(next, { caseId: kase.id })).ownerId).toBe(next.user.id);
  });

  it("approves a standard-risk case without a note", async () => {
    const { kase } = await newCase({ riskRating: "medium" });
    const a = await analyst();
    await claimCase(a, { caseId: kase.id });
    const view = await decideCase(a, { caseId: kase.id, decision: "approve" }, config);
    expect(view).toMatchObject({ status: "approved", decisionNote: null });
    expect(await auditFor(kase.id, "kyc.approved")).toHaveLength(1);
  });

  it("refuses an unknown decision", async () => {
    const { kase } = await newCase();
    const a = await analyst();
    await claimCase(a, { caseId: kase.id });
    await expect(decideCase(a, { caseId: kase.id, decision: "delete" as never }, config)).rejects.toBeInstanceOf(ValidationError);
  });

  it("refuses a second decision on a closed case", async () => {
    const { kase } = await newCase();
    const a = await analyst();
    await claimCase(a, { caseId: kase.id });
    await decideCase(a, { caseId: kase.id, decision: "approve" }, config);
    await expect(decideCase(a, { caseId: kase.id, decision: "reject", note: "changed my mind" }, config)).rejects.toBeInstanceOf(ConflictError);
    expect((await caseRow(kase.id))?.status).toBe("approved");
  });
});

describe("rule 3: high-risk (sanctions or PEP) approval needs a second person's sign-off", () => {
  it("classes a case as high-risk on a high rating, a sanctions hit or a PEP flag", () => {
    expect(isHighRisk({ riskRating: "high", sanctionsHit: false, pep: false })).toBe(true);
    expect(isHighRisk({ riskRating: "low", sanctionsHit: true, pep: false })).toBe(true);
    expect(isHighRisk({ riskRating: "low", sanctionsHit: false, pep: true })).toBe(true);
    expect(isHighRisk({ riskRating: "medium", sanctionsHit: false, pep: false })).toBe(false);
  });

  it("holds a high-risk approve as pending sign-off instead of approving it", async () => {
    const { kase, view } = await pendingSignOff();
    expect(view.status).toBe("pending_approval");
    expect(view.closedAt).toBeNull();
    expect(view.approval).toMatchObject({ status: "pending" });
    const [request] = await db.select().from(approvalRequests).where(eq(approvalRequests.subjectId, kase.id));
    expect(request).toMatchObject({ kind: "kyc.high_risk_approval", subjectType: "kyc_case" });
    for (const value of piiOf(kase)) expect(JSON.stringify(request?.payload)).not.toContain(value);
  });

  it("blocks the requester from signing off their own case", async () => {
    const { kase } = await highRisk();
    const senior = await as(["analyst", "approver"]);
    await claimCase(senior, { caseId: kase.id });
    const view = await decideCase(senior, { caseId: kase.id, decision: "approve" }, config);
    await expect(
      signOffCase(senior, { caseId: kase.id, decision: "approve", expectedVersion: view.approval?.version ?? 0 }, config),
    ).rejects.toBeInstanceOf(SelfApprovalError);
    expect((await caseRow(kase.id))?.status).toBe("pending_approval");
  });

  it("closes the case as approved when a different approver signs off (positive control)", async () => {
    const { kase, view } = await pendingSignOff();
    const checker = await approver();
    const after = await signOffCase(checker, { caseId: kase.id, decision: "approve", expectedVersion: view.approval?.version ?? 0 }, config);
    expect(after).toMatchObject({ status: "approved", approval: { status: "approved" } });
    expect(after.retentionUntil).toBeInstanceOf(Date);
    expect(await auditFor(kase.id, "kyc.approved")).toHaveLength(1);
  });

  it("returns the case to its owner when the checker rejects the sign-off", async () => {
    const { kase, maker, view } = await pendingSignOff();
    const after = await signOffCase(
      await approver(),
      { caseId: kase.id, decision: "reject", note: "PEP source of wealth not evidenced", expectedVersion: view.approval?.version ?? 0 },
      config,
    );
    expect(after).toMatchObject({ status: "in_review", ownerId: maker.user.id, closedAt: null });
    // The owner can then act again, e.g. reject it outright.
    expect((await decideCase(maker, { caseId: kase.id, decision: "reject", note: "Source of wealth unverified" }, config)).status).toBe("rejected");
  });

  it("denies sign-off to an analyst (no kyc:approve)", async () => {
    const { kase, view } = await pendingSignOff();
    await expect(
      signOffCase(await analyst(), { caseId: kase.id, decision: "approve", expectedVersion: view.approval?.version ?? 0 }, config),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await caseRow(kase.id))?.status).toBe("pending_approval");
  });

  it("database refuses to approve a high-risk case with no approved sign-off, even as the owner role", async () => {
    const { kase } = await highRisk();
    const a = await analyst();
    await claimCase(a, { caseId: kase.id });
    const now = new Date();
    const later = new Date(now);
    later.setUTCFullYear(now.getUTCFullYear() + 5);
    await expectDbError(
      owner.update(kycCases).set({ status: "approved", closedAt: now, retentionUntil: later }).where(eq(kycCases.id, kase.id)),
      /four-eyes/,
    );
  });

  it("database allows the same direct approval of a standard-risk case (positive control)", async () => {
    const { kase } = await newCase();
    const a = await analyst();
    await claimCase(a, { caseId: kase.id });
    const now = new Date();
    const later = new Date(now);
    later.setUTCFullYear(now.getUTCFullYear() + 5);
    await owner.update(kycCases).set({ status: "approved", closedAt: now, retentionUntil: later }).where(eq(kycCases.id, kase.id));
    expect((await caseRow(kase.id))?.status).toBe("approved");
  });
});

describe("rule 4: DOB, ID number and address are masked; revealing needs a reason and is audited", () => {
  it("never returns raw applicant PII in the queue or the case view", async () => {
    const { kase, doc } = await newCase();
    const reader = await approver();
    const { rows } = await listKycCases(reader, { search: kase.reference });
    const view = await getKycCase(reader, kase.id);
    const out = JSON.stringify({ rows, view });
    for (const value of piiOf(kase)) expect(out).not.toContain(value);
    expect(out).not.toContain(doc.content);
    expect(view).toMatchObject({ reference: kase.reference, nationality: "GB" });
  });

  it("refuses a reveal without a reason and writes no field.unmask row", async () => {
    const { kase } = await newCase();
    await expect(revealCaseField(await approver(), { caseId: kase.id, field: "idNumber", reason: "  " })).rejects.toBeInstanceOf(
      ValidationError,
    );
    expect(await auditFor(kase.id, "field.unmask")).toHaveLength(0);
  });

  it("reveals with a reason and audits it without the value (positive control)", async () => {
    const { kase } = await newCase();
    const reader = await approver();
    for (const field of ["dateOfBirth", "idNumber", "address"] as const) {
      expect(await revealCaseField(reader, { caseId: kase.id, field, reason: "Checking against passport" })).toBe(kase[field]);
    }
    const rows = await auditFor(kase.id, "field.unmask");
    expect(rows).toHaveLength(3);
    expect(rows[0]).toMatchObject({ entityType: "kyc_case", reason: "Checking against passport", actorUserId: reader.user.id });
    for (const value of piiOf(kase)) expect(JSON.stringify(rows)).not.toContain(value);
  });

  it("denies a reveal to an analyst (no pii:unmask) and writes access.denied", async () => {
    const { kase } = await newCase();
    const a = await analyst();
    await expect(revealCaseField(a, { caseId: kase.id, field: "address", reason: "curious" })).rejects.toBeInstanceOf(ForbiddenError);
    const rows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.actorUserId, a.user.id), eq(auditLog.action, "access.denied")));
    expect(rows).toHaveLength(1);
  });

  it("refuses to reveal a field that isn't masked", async () => {
    const { kase } = await newCase();
    await expect(revealCaseField(await approver(), { caseId: kase.id, field: "ownerId" as never, reason: "x" })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe("rule 5: opening a document needs a reason and writes a field.unmask row", () => {
  it("refuses to open a document without a reason and writes nothing", async () => {
    const { doc } = await newCase();
    await expect(openCaseDocument(await approver(), { documentId: doc.id, reason: "" })).rejects.toBeInstanceOf(ValidationError);
    expect(await auditFor(doc.id, "field.unmask")).toHaveLength(0);
  });

  it("opens it with a reason and audits the open without the content (positive control)", async () => {
    const { doc } = await newCase();
    const reader = await approver();
    const opened = await openCaseDocument(reader, { documentId: doc.id, reason: "Verifying photo ID" });
    expect(opened).toMatchObject({ id: doc.id, content: doc.content, fileName: "passport.pdf" });
    const [row] = await auditFor(doc.id, "field.unmask");
    expect(row).toMatchObject({ entityType: "kyc_document", reason: "Verifying photo ID", metadata: { field: "content" } });
    expect(JSON.stringify(row)).not.toContain(doc.content);
  });

  it("denies opening a document to an analyst (no pii:unmask)", async () => {
    const { doc } = await newCase();
    await expect(openCaseDocument(await analyst(), { documentId: doc.id, reason: "check" })).rejects.toBeInstanceOf(ForbiddenError);
    expect(await auditFor(doc.id, "field.unmask")).toHaveLength(0);
  });
});

describe("rule 6: closed cases are kept for the retention period and can't be deleted", () => {
  it("defaults retention to five years and reads KYC_RETENTION_YEARS", () => {
    expect(loadKycConfig({})).toEqual({ retentionYears: 5 });
    expect(loadKycConfig({ KYC_RETENTION_YEARS: "7" })).toEqual({ retentionYears: 7 });
  });

  it("refuses a retention below five years or that isn't a whole number", () => {
    for (const bad of ["4", "0", "-5", "5.5", "five"]) expect(() => loadKycConfig({ KYC_RETENTION_YEARS: bad })).toThrow(/KYC_RETENTION_YEARS/);
  });

  it("sets retention to the configured years after closing", async () => {
    const { kase } = await newCase();
    const a = await analyst();
    await claimCase(a, { caseId: kase.id });
    const view = await decideCase(a, { caseId: kase.id, decision: "reject", note: "Fake ID" }, { retentionYears: 7 });
    const expected = new Date(view.closedAt as Date);
    expected.setUTCFullYear(expected.getUTCFullYear() + 7);
    expect(view.retentionUntil?.toISOString()).toBe(expected.toISOString());
  });

  it("database refuses to delete a closed case or its documents, even as the owner role", async () => {
    const { kase } = await newCase();
    const a = await analyst();
    await claimCase(a, { caseId: kase.id });
    await decideCase(a, { caseId: kase.id, decision: "approve" }, config);
    await expectDbError(owner.delete(kycDocuments).where(eq(kycDocuments.caseId, kase.id)), /retained/);
    await expectDbError(owner.delete(kycCases).where(eq(kycCases.id, kase.id)), /retained/);
    expect(await caseRow(kase.id)).toBeDefined();
  });

  it("database lets the owner role delete an open case's rows (positive control)", async () => {
    const { kase } = await newCase();
    await owner.delete(kycDocuments).where(eq(kycDocuments.caseId, kase.id));
    await owner.delete(kycCases).where(eq(kycCases.id, kase.id));
    expect(await caseRow(kase.id)).toBeUndefined();
  });

  it("app_runtime can't delete, insert, or edit applicant details at all", async () => {
    const { kase } = await newCase();
    await expectDbError(db.delete(kycCases).where(eq(kycCases.id, kase.id)), /permission denied/);
    await expectDbError(db.delete(kycDocuments).where(eq(kycDocuments.caseId, kase.id)), /permission denied/);
    await expectDbError(db.insert(kycCases).values({ ...seedKycCases(1)[0]!.kase, reference: `KYC-T-${randomUUID()}` }), /permission denied/);
    await expectDbError(db.update(kycCases).set({ address: "1 Other Street" }).where(eq(kycCases.id, kase.id)), /permission denied/);
  });

  it("database refuses to reopen or edit a closed case", async () => {
    const { kase } = await newCase();
    const a = await analyst();
    await claimCase(a, { caseId: kase.id });
    await decideCase(a, { caseId: kase.id, decision: "reject", note: "Fake ID" }, config);
    await expectDbError(owner.update(kycCases).set({ decisionNote: "edited" }).where(eq(kycCases.id, kase.id)), /closed/);
  });
});

describe("rule 7: the case page shows its full audit and approval history", () => {
  it("merges case, approval and document rows newest first, without PII", async () => {
    const { kase, view } = await pendingSignOff();
    const checker = await approver();
    await openCaseDocument(checker, { documentId: view.documents[0]!.id, reason: "Verifying photo ID" });
    await revealCaseField(checker, { caseId: kase.id, field: "dateOfBirth", reason: "Age check" });
    await signOffCase(checker, { caseId: kase.id, decision: "approve", expectedVersion: view.approval?.version ?? 0 }, config);
    const history = await caseHistory(db, kase.id);
    const actions = history.map((h) => h.action);
    expect(actions).toEqual(
      expect.arrayContaining(["kyc.claimed", "kyc.approval_requested", "approval.requested", "field.unmask", "approval.approved", "kyc.approved"]),
    );
    expect(actions.filter((a) => a === "field.unmask")).toHaveLength(2);
    expect(actions[0]).toBe("kyc.approved");
    expect(actions.at(-1)).toBe("kyc.claimed");
    const times = history.map((h) => h.occurredAt.getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times);
    for (const value of piiOf(kase)) expect(JSON.stringify(history)).not.toContain(value);
  });

  it("returns nothing for an unknown case id", async () => {
    expect(await caseHistory(db, randomUUID())).toEqual([]);
    expect(await caseHistory(db, "not-a-uuid")).toEqual([]);
  });
});

describe("kyc seed data is synthetic", () => {
  it("uses fake markers for ID numbers, postcodes and documents", () => {
    const cases = seedKycCases();
    expect(cases).toHaveLength(30);
    for (const { kase, documents } of cases) {
      expect(kase.idNumber).toMatch(/^TST-\d{6}$/);
      expect(kase.address).toMatch(/ZZ\d \dTT$/);
      for (const d of documents) expect(d.content).toContain("SYNTHETIC TEST DOCUMENT");
    }
    expect(cases.some((c) => isHighRisk(c.kase as never))).toBe(true);
  });
});
