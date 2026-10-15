import { and, asc, count, desc, eq, ilike, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  ConflictError,
  ForbiddenError,
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
import {
  approvalRequests,
  kycCases,
  kycDocuments,
  users,
  type Db,
  type Executor,
  type KycCaseRow,
  type KycDocumentRow,
  type Tx,
} from "@fit/db";

export interface KycConfig {
  /** Closed cases are kept (no delete) for this many years after closing. */
  retentionYears: number;
}

/** UK MLR 2017 reg. 40: keep CDD records five years after the relationship ends (research S11/S12). */
export const DEFAULT_RETENTION_YEARS = 5;
export const MIN_RETENTION_YEARS = 5;
const MAX_RETENTION_YEARS = 100;

export function loadKycConfig(env: Record<string, string | undefined> = process.env): KycConfig {
  const raw = env.KYC_RETENTION_YEARS?.trim();
  if (!raw) return { retentionYears: DEFAULT_RETENTION_YEARS };
  const years = Number(raw);
  if (!/^\d+$/.test(raw) || years < MIN_RETENTION_YEARS || years > MAX_RETENTION_YEARS) {
    throw new Error(`KYC_RETENTION_YEARS must be a whole number of years from ${MIN_RETENTION_YEARS} to ${MAX_RETENTION_YEARS}, got "${raw}"`);
  }
  return { retentionYears: years };
}

export const KYC_STATUSES = ["open", "in_review", "pending_approval", "escalated", "approved", "rejected"] as const;
export type KycStatus = (typeof KYC_STATUSES)[number];
export const KYC_DECISIONS = ["approve", "reject", "escalate"] as const;
export type KycDecision = (typeof KYC_DECISIONS)[number];
export type KycMaskedField = "applicantName" | "dateOfBirth" | "idNumber" | "address";

export interface KycCaseListItem {
  id: string;
  reference: string;
  /** Always masked ("Jane S."). */
  applicantName: string;
  nationality: string;
  riskRating: "low" | "medium" | "high";
  sanctionsHit: boolean;
  pep: boolean;
  highRisk: boolean;
  status: KycStatus;
  ownerId: string | null;
  ownerName: string | null;
  openedAt: Date;
}

export interface KycCaseView extends KycCaseListItem {
  /** Always masked. */
  dateOfBirth: string;
  /** Always masked. */
  idNumber: string;
  /** Always masked. */
  address: string;
  claimedAt: Date | null;
  decisionNote: string | null;
  closedAt: Date | null;
  retentionUntil: Date | null;
  /** Metadata only: content is only returned by openCaseDocument. */
  documents: { id: string; kind: string; fileName: string }[];
  /** The latest four-eyes request for this case, if any. */
  approval: {
    id: string;
    status: "pending" | "approved" | "rejected" | "cancelled";
    version: number;
    requestedBy: string;
    requestedByName: string;
    decidedByName: string | null;
    decisionNote: string | null;
  } | null;
}

export interface KycListQuery {
  search?: string;
  status?: string;
  sort?: string;
  dir?: "asc" | "desc";
  page?: number;
  pageSize?: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_NOTE = 1000;
const MAX_SEARCH = 100;

/** Four-eyes applies on a high rating, a sanctions hit or a PEP flag. */
export function isHighRisk(c: { riskRating: string; sanctionsHit: boolean; pep: boolean }): boolean {
  return c.riskRating === "high" || c.sanctionsHit || c.pep;
}

// ---------------------------------------------------------------------------
// Masking: applicant name, DOB, ID number and address are masked for every reader; documents in full.

const CASE_POLICIES = [
  { field: "applicantName", style: "name", unmaskPermission: "pii:unmask" },
  { field: "dateOfBirth", style: "full", unmaskPermission: "pii:unmask" },
  { field: "idNumber", style: "full", unmaskPermission: "pii:unmask" },
  { field: "address", style: "full", unmaskPermission: "pii:unmask" },
] as const;
const NAME_POLICY = [CASE_POLICIES[0]] as const;

const caseEntity = defineMaskedEntity<KycCaseRow>({
  entityType: "kyc_case",
  policies: CASE_POLICIES,
  load: async (tx, id) => (await tx.select().from(kycCases).where(eq(kycCases.id, id)))[0] ?? null,
});

const documentEntity = defineMaskedEntity<KycDocumentRow>({
  entityType: "kyc_document",
  policies: [{ field: "content", style: "full", unmaskPermission: "pii:unmask" }],
  load: async (tx, id) => (await tx.select().from(kycDocuments).where(eq(kycDocuments.id, id)))[0] ?? null,
});

const caseResource = (caseId: string) => `kyc_case:${caseId}`;

export async function revealCaseField(
  ctx: ActionContext,
  input: { caseId: string; field: KycMaskedField; reason: string },
): Promise<string | null> {
  if (!CASE_POLICIES.some((p) => p.field === input.field)) throw new ValidationError(`${String(input.field)} is not a masked field`);
  if (!UUID.test(input.caseId)) throw new NotFoundError(`KYC case ${input.caseId} not found`);
  await requirePermission({ db: ctx.db, user: ctx.user, resource: caseResource(input.caseId) }, "kyc:read");
  return unmask(ctx.db, ctx.user, caseEntity, { entityId: input.caseId, field: input.field, reason: input.reason });
}

/** Returns a document's content; writes a `field.unmask` row (entity kyc_document, field content). */
export async function openCaseDocument(
  ctx: ActionContext,
  input: { documentId: string; reason: string },
): Promise<{ id: string; caseId: string; kind: string; fileName: string; content: string }> {
  if (!UUID.test(input.documentId)) throw new NotFoundError(`document ${input.documentId} not found`);
  await requirePermission({ db: ctx.db, user: ctx.user, resource: `kyc_document:${input.documentId}` }, "kyc:read");
  const content = await unmask(ctx.db, ctx.user, documentEntity, { entityId: input.documentId, field: "content", reason: input.reason });
  const [doc] = await ctx.db
    .select({ id: kycDocuments.id, caseId: kycDocuments.caseId, kind: kycDocuments.kind, fileName: kycDocuments.fileName })
    .from(kycDocuments)
    .where(eq(kycDocuments.id, input.documentId));
  if (!doc || content === null) throw new NotFoundError(`document ${input.documentId} not found`);
  return { ...doc, content };
}

// ---------------------------------------------------------------------------
// Reads

const caseOwner = alias(users, "case_owner");
const requester = alias(users, "requester");
const decider = alias(users, "decider");

const CASE_SORTS = {
  reference: kycCases.reference,
  riskRating: kycCases.riskRating,
  status: kycCases.status,
  openedAt: kycCases.openedAt,
} as const;

const wholeIn = (n: number | undefined, min: number, max: number, fallback: number) =>
  n !== undefined && Number.isFinite(n) ? Math.min(Math.max(min, Math.trunc(n)), max) : fallback;

/** URL values are untrusted: clamp to whole numbers so the SQL offset is always valid. */
const page = (q: KycListQuery) => {
  const pageSize = wholeIn(q.pageSize, 1, 1000, 20);
  return { pageSize, offset: (wholeIn(q.page, 1, Math.floor(Number.MAX_SAFE_INTEGER / pageSize), 1) - 1) * pageSize };
};

const isStatus = (s: unknown): s is KycStatus => KYC_STATUSES.includes(s as KycStatus);

/** The queue. Search matches the case reference only: searching masked fields would leak them. */
export async function listKycCases(ctx: ActionContext, query: KycListQuery): Promise<{ rows: KycCaseListItem[]; total: number }> {
  await requirePermission({ db: ctx.db, user: ctx.user, resource: "kyc:queue" }, "kyc:read");
  const q = query.search?.trim().slice(0, MAX_SEARCH);
  const where = and(
    q ? ilike(kycCases.reference, `%${q.replace(/[\\%_]/g, "\\$&")}%`) : undefined,
    isStatus(query.status) ? eq(kycCases.status, query.status) : undefined,
  );
  const sortCol = CASE_SORTS[query.sort as keyof typeof CASE_SORTS] ?? kycCases.openedAt;
  const dir = query.dir === "desc" ? desc : asc;
  const { pageSize, offset } = page(query);
  const rows = await ctx.db
    .select({
      id: kycCases.id,
      reference: kycCases.reference,
      applicantName: kycCases.applicantName,
      nationality: kycCases.nationality,
      riskRating: kycCases.riskRating,
      sanctionsHit: kycCases.sanctionsHit,
      pep: kycCases.pep,
      status: kycCases.status,
      ownerId: kycCases.ownerId,
      ownerName: sql<string | null>`coalesce(${caseOwner.displayName}, ${caseOwner.username})`,
      openedAt: kycCases.openedAt,
    })
    .from(kycCases)
    .leftJoin(caseOwner, eq(caseOwner.id, kycCases.ownerId))
    .where(where)
    .orderBy(dir(sortCol), asc(kycCases.id))
    .limit(pageSize)
    .offset(offset);
  const [total] = await ctx.db.select({ n: count() }).from(kycCases).where(where);
  return { rows: rows.map((r) => ({ ...mask(r, NAME_POLICY), highRisk: isHighRisk(r) })), total: total?.n ?? 0 };
}

async function loadCaseView(db: Executor, caseId: string): Promise<KycCaseView | null> {
  if (!UUID.test(caseId)) return null;
  const [row] = await db
    .select({ kase: kycCases, ownerName: sql<string | null>`coalesce(${caseOwner.displayName}, ${caseOwner.username})` })
    .from(kycCases)
    .leftJoin(caseOwner, eq(caseOwner.id, kycCases.ownerId))
    .where(eq(kycCases.id, caseId));
  if (!row) return null;
  const documents = await db
    .select({ id: kycDocuments.id, kind: kycDocuments.kind, fileName: kycDocuments.fileName })
    .from(kycDocuments)
    .where(eq(kycDocuments.caseId, caseId))
    .orderBy(asc(kycDocuments.uploadedAt), asc(kycDocuments.id));
  const [approval] = await db
    .select({
      id: approvalRequests.id,
      status: approvalRequests.status,
      version: approvalRequests.version,
      requestedBy: approvalRequests.requestedBy,
      requestedByName: sql<string>`coalesce(${requester.displayName}, ${requester.username})`,
      decidedByName: sql<string | null>`coalesce(${decider.displayName}, ${decider.username})`,
      decisionNote: approvalRequests.decisionNote,
    })
    .from(approvalRequests)
    .innerJoin(requester, eq(requester.id, approvalRequests.requestedBy))
    .leftJoin(decider, eq(decider.id, approvalRequests.decidedBy))
    .where(and(eq(approvalRequests.kind, kycApproval.kind), eq(approvalRequests.subjectId, caseId)))
    .orderBy(desc(approvalRequests.requestedAt), desc(approvalRequests.id))
    .limit(1);
  const k = mask(row.kase, CASE_POLICIES);
  return {
    id: k.id,
    reference: k.reference,
    applicantName: k.applicantName,
    dateOfBirth: k.dateOfBirth,
    idNumber: k.idNumber,
    address: k.address,
    nationality: k.nationality,
    riskRating: k.riskRating,
    sanctionsHit: k.sanctionsHit,
    pep: k.pep,
    highRisk: isHighRisk(k),
    status: k.status,
    ownerId: k.ownerId,
    ownerName: row.ownerName,
    claimedAt: k.claimedAt,
    decisionNote: k.decisionNote,
    openedAt: k.openedAt,
    closedAt: k.closedAt,
    retentionUntil: k.retentionUntil,
    documents,
    approval: approval ?? null,
  };
}

export async function getKycCase(ctx: ActionContext, caseId: string): Promise<KycCaseView | null> {
  await requirePermission({ db: ctx.db, user: ctx.user, resource: caseResource(caseId) }, "kyc:read");
  return loadCaseView(ctx.db, caseId);
}

/** Audit history of a case, its approval requests and its documents, newest first (feeds Timeline). */
export async function caseHistory(db: Db, caseId: string): Promise<AuditListItem[]> {
  if (!UUID.test(caseId)) return [];
  const [kase] = await db.select({ id: kycCases.id }).from(kycCases).where(eq(kycCases.id, caseId));
  if (!kase) return [];
  const requests = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.kind, kycApproval.kind), eq(approvalRequests.subjectId, caseId)));
  const docs = await db.select({ id: kycDocuments.id }).from(kycDocuments).where(eq(kycDocuments.caseId, caseId));
  const lists = await Promise.all([
    listAuditForEntity(db, "kyc_case", caseId),
    ...requests.map((r) => listAuditForEntity(db, "approval_request", r.id)),
    ...docs.map((d) => listAuditForEntity(db, "kyc_document", d.id)),
  ]);
  return lists.flat().sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id - a.id);
}

// ---------------------------------------------------------------------------
// Writes

interface KycApprovalPayload {
  reference: string;
  riskRating: string;
  sanctionsHit: boolean;
  pep: boolean;
}

/** Thrown inside a transaction when the actor doesn't own the case; turned into an audited denial outside it. */
class NotCaseOwner extends Error {}

const actorRef = (ctx: ActionContext) => ({ id: ctx.user.id, subject: ctx.user.subject });

export const kycApproval = defineApprovalKind<KycApprovalPayload>({
  kind: "kyc.high_risk_approval",
  subjectType: "kyc_case",
  requestPermission: "kyc:request",
  approvePermission: "kyc:approve",
});

/** Locks the case row so claims and decisions on it run one at a time. */
async function lockCase(tx: Tx, caseId: string): Promise<KycCaseRow> {
  const [kase] = await tx.select().from(kycCases).where(eq(kycCases.id, caseId)).for("update");
  if (!kase) throw new NotFoundError(`KYC case ${caseId} not found`);
  return kase;
}

/** Writes the access.denied row on its own (so it survives) and throws. */
async function denyNotOwner(ctx: ActionContext, caseId: string): Promise<never> {
  await withAudit(
    ctx.db,
    {
      actor: actorRef(ctx),
      action: "access.denied",
      entityType: "resource",
      entityId: caseResource(caseId),
      metadata: { required: "kyc:case-owner", roles: ctx.user.roles },
    },
    async () => undefined,
  );
  throw new ForbiddenError("kyc:case-owner");
}

/** Runs fn under the case lock; a non-owner gets an audited denial instead. */
async function asOwner<T>(ctx: ActionContext, caseId: string, fn: (tx: Tx, kase: KycCaseRow) => Promise<T>, executor: Executor = ctx.db) {
  try {
    return await executor.transaction(async (tx) => {
      const kase = await lockCase(tx, caseId);
      if (kase.ownerId !== ctx.user.id) throw new NotCaseOwner();
      return fn(tx, kase);
    });
  } catch (err) {
    if (err instanceof NotCaseOwner) return denyNotOwner(ctx, caseId);
    throw err;
  }
}

const closing = (years: number) => ({
  closedAt: sql`now()`,
  retentionUntil: sql`now() + make_interval(years => ${years})`,
});

async function closeCase(
  tx: Tx,
  ctx: ActionContext,
  kase: KycCaseRow,
  status: "approved" | "rejected",
  note: string | null,
  config: KycConfig,
): Promise<void> {
  await withAudit(
    tx,
    {
      actor: actorRef(ctx),
      action: `kyc.${status}`,
      entityType: "kyc_case",
      entityId: kase.id,
      reason: note,
      before: { status: kase.status },
      after: { status, retentionYears: config.retentionYears },
    },
    async (t) => {
      const updated = await t
        .update(kycCases)
        .set({ status, decisionNote: note, ...closing(config.retentionYears) })
        .where(and(eq(kycCases.id, kase.id), eq(kycCases.status, kase.status)))
        .returning({ id: kycCases.id });
      if (updated.length !== 1) throw new ConflictError(`KYC case ${kase.reference} changed`);
    },
  );
}

async function viewOrThrow(db: Executor, caseId: string): Promise<KycCaseView> {
  const view = await loadCaseView(db, caseId);
  if (!view) throw new NotFoundError(`KYC case ${caseId} not found`);
  return view;
}

export async function claimCase(ctx: ActionContext, input: { caseId: string }): Promise<KycCaseView> {
  // A bad retention setting would only fail at decision time, leaving the claimed case stuck.
  loadKycConfig();
  if (!UUID.test(input.caseId)) throw new NotFoundError(`KYC case ${input.caseId} not found`);
  await requirePermission({ db: ctx.db, user: ctx.user, resource: caseResource(input.caseId) }, "kyc:request");
  await ctx.db.transaction(async (tx) => {
    const kase = await lockCase(tx, input.caseId);
    if (kase.status !== "open" && kase.status !== "escalated") {
      throw new ConflictError(`KYC case ${kase.reference} is already ${kase.status.replace("_", " ")}`);
    }
    await withAudit(
      tx,
      {
        actor: actorRef(ctx),
        action: "kyc.claimed",
        entityType: "kyc_case",
        entityId: kase.id,
        before: { status: kase.status, ownerId: null },
        after: { status: "in_review", ownerId: ctx.user.id },
      },
      async (t) => {
        await t.update(kycCases).set({ status: "in_review", ownerId: ctx.user.id, claimedAt: sql`now()` }).where(eq(kycCases.id, kase.id));
      },
    );
  });
  return viewOrThrow(ctx.db, input.caseId);
}

function validateNote(note: unknown, required: boolean, what: string): string | null {
  const trimmed = typeof note === "string" ? note.trim() : "";
  if (required && !trimmed) throw new ValidationError(`${what} needs a note`);
  if (trimmed.length > MAX_NOTE) throw new ValidationError(`note must be at most ${MAX_NOTE} characters`);
  return trimmed || null;
}

const requireInReview = (kase: KycCaseRow) => {
  if (kase.status !== "in_review") throw new ConflictError(`KYC case ${kase.reference} is ${kase.status.replace("_", " ")}`);
};

/**
 * The owner's decision. Approving a high-risk case raises a four-eyes request instead (status
 * pending_approval); reject and escalate need a note. Escalating releases the case.
 */
export async function decideCase(
  ctx: ActionContext,
  input: { caseId: string; decision: KycDecision; note?: string },
  config: KycConfig = loadKycConfig(),
): Promise<KycCaseView> {
  if (!KYC_DECISIONS.includes(input.decision)) throw new ValidationError(`invalid decision: ${String(input.decision)}`);
  if (!UUID.test(input.caseId)) throw new NotFoundError(`KYC case ${input.caseId} not found`);
  const note = validateNote(input.note, input.decision !== "approve", input.decision === "reject" ? "rejecting" : "escalating");
  await requirePermission({ db: ctx.db, user: ctx.user, resource: caseResource(input.caseId) }, "kyc:request");

  // Check ownership first, so a non-owner gets a denial rather than an approval request.
  const kase = await asOwner(ctx, input.caseId, async (_tx, k) => k);

  if (input.decision === "approve" && isHighRisk(kase)) {
    requireInReview(kase);
    await requestApproval(
      ctx.db,
      ctx.user,
      {
        ...kycApproval,
        onRequested: (tx, request) =>
          asOwner(
            ctx,
            input.caseId,
            async (t, locked) => {
              requireInReview(locked);
              await withAudit(
                t,
                {
                  actor: actorRef(ctx),
                  action: "kyc.approval_requested",
                  entityType: "kyc_case",
                  entityId: locked.id,
                  reason: note,
                  before: { status: locked.status },
                  after: { status: "pending_approval", approvalRequestId: request.id },
                },
                async (t2) => {
                  await t2.update(kycCases).set({ status: "pending_approval", decisionNote: note }).where(eq(kycCases.id, locked.id));
                },
              );
            },
            tx,
          ),
      },
      { subjectId: kase.id, payload: { reference: kase.reference, riskRating: kase.riskRating, sanctionsHit: kase.sanctionsHit, pep: kase.pep } },
    );
    return viewOrThrow(ctx.db, input.caseId);
  }

  await asOwner(ctx, input.caseId, async (tx, locked) => {
    requireInReview(locked);
    if (input.decision === "escalate") {
      await withAudit(
        tx,
        {
          actor: actorRef(ctx),
          action: "kyc.escalated",
          entityType: "kyc_case",
          entityId: locked.id,
          reason: note,
          before: { status: locked.status, ownerId: locked.ownerId },
          after: { status: "escalated", ownerId: null },
        },
        async (t) => {
          await t.update(kycCases).set({ status: "escalated", ownerId: null, claimedAt: null, decisionNote: note }).where(eq(kycCases.id, locked.id));
        },
      );
    } else {
      await closeCase(tx, ctx, locked, input.decision === "approve" ? "approved" : "rejected", note, config);
    }
  });
  return viewOrThrow(ctx.db, input.caseId);
}

/** The checker's decision on a pending high-risk approval; core blocks the requester. */
export async function signOffCase(
  ctx: ActionContext,
  input: { caseId: string; decision: "approve" | "reject"; note?: string; expectedVersion: number },
  config: KycConfig = loadKycConfig(),
): Promise<KycCaseView> {
  const view = await loadCaseView(ctx.db, input.caseId);
  if (!view) throw new NotFoundError(`KYC case ${input.caseId} not found`);
  if (view.status !== "pending_approval" || view.approval?.status !== "pending") {
    throw new ConflictError(`KYC case ${view.reference} has no pending sign-off`);
  }
  await decideApproval(
    ctx.db,
    ctx.user,
    {
      ...kycApproval,
      onApproved: async (tx) => {
        const kase = await lockCase(tx, input.caseId);
        if (kase.status !== "pending_approval") throw new ConflictError(`KYC case ${kase.reference} is ${kase.status}`);
        await closeCase(tx, ctx, kase, "approved", kase.decisionNote, config);
      },
      onRejected: async (tx, request) => {
        const kase = await lockCase(tx, input.caseId);
        if (kase.status !== "pending_approval") throw new ConflictError(`KYC case ${kase.reference} is ${kase.status}`);
        await withAudit(
          tx,
          {
            actor: actorRef(ctx),
            action: "kyc.signoff_rejected",
            entityType: "kyc_case",
            entityId: kase.id,
            reason: request.decisionNote,
            before: { status: kase.status },
            after: { status: "in_review", ownerId: kase.ownerId },
          },
          async (t) => {
            await t.update(kycCases).set({ status: "in_review" }).where(eq(kycCases.id, kase.id));
          },
        );
      },
    },
    { id: view.approval.id, decision: input.decision, note: input.note, expectedVersion: input.expectedVersion },
  );
  return viewOrThrow(ctx.db, input.caseId);
}
