import { and, asc, eq, ilike, inArray, or, type SQL } from "drizzle-orm";
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
import {
  approvalRequests,
  flagChanges,
  flagValues,
  flags,
  users,
  type Db,
  type Executor,
  type FlagEnvironment,
  type FlagValueRow,
  type Tx,
} from "@fit/db";

export const ENVIRONMENTS = ["dev", "staging", "prod"] as const satisfies readonly FlagEnvironment[];

export interface FlagValue {
  enabled: boolean;
  rolloutPercentage: number;
}

export interface FlagEnvironmentValue extends FlagValue {
  version: number;
  updatedAt: Date;
}

export interface FlagListItem {
  id: string;
  key: string;
  description: string;
  values: Record<FlagEnvironment, FlagValue>;
  hasPendingChange: boolean;
}

export interface FlagChangeView {
  id: string;
  flagId: string;
  flagKey: string;
  environment: FlagEnvironment;
  before: FlagValue;
  after: FlagValue;
  reason: string;
  status: "pending" | "applied" | "rejected";
  requestedBy: string;
  requestedByName: string;
  requestedAt: Date;
  approval: { id: string; version: number; status: string };
}

export interface FlagView {
  id: string;
  key: string;
  description: string;
  values: Record<FlagEnvironment, FlagEnvironmentValue>;
  pendingChange: FlagChangeView | null;
}

export interface FlagChangeInput {
  flagId: string;
  environment: FlagEnvironment;
  enabled: boolean;
  rolloutPercentage: number;
  reason: string;
  expectedVersion: number;
  /** Minted when the form renders; a resubmitted prod request with the same id creates one change. */
  changeId: string;
}

export type FlagChangeOutcome = "applied" | "killed" | "pending_approval";

export interface FlagsServiceConfig {
  /** Bearer token services send to GET /api/flags. null switches the endpoint off. */
  serviceToken: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_REASON = 500;
const MIN_TOKEN_LENGTH = 16;

export function loadFlagsServiceConfig(env: Record<string, string | undefined> = process.env): FlagsServiceConfig {
  const raw = env.FLAGS_SERVICE_TOKEN?.trim();
  if (!raw) return { serviceToken: null };
  if (raw.length < MIN_TOKEN_LENGTH) throw new Error(`FLAGS_SERVICE_TOKEN must be at least ${MIN_TOKEN_LENGTH} characters`);
  return { serviceToken: raw };
}

/** Form input: digits only, 0 to 100. No "%", decimals or exponents. */
export function parseRolloutPercentage(raw: string): number {
  const text = raw.trim();
  if (!/^(0|[1-9]\d{0,2})$/.test(text) || Number(text) > 100) {
    throw new ValidationError("rollout must be a whole number from 0 to 100");
  }
  return Number(text);
}

function validateValue(value: FlagValue): FlagValue {
  if (typeof value.enabled !== "boolean") throw new ValidationError("enabled must be true or false");
  const r = value.rolloutPercentage;
  if (!Number.isInteger(r) || r < 0 || r > 100) throw new ValidationError("rollout must be a whole number from 0 to 100");
  return { enabled: value.enabled, rolloutPercentage: r };
}

function validateReason(raw: unknown): string {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (!reason) throw new ValidationError("a flag change needs a reason");
  if (reason.length > MAX_REASON) throw new ValidationError(`reason must be at most ${MAX_REASON} characters`);
  return reason;
}

function validateInput(input: FlagChangeInput): FlagChangeInput {
  if (!UUID.test(String(input.flagId))) throw new NotFoundError(`flag ${input.flagId} not found`);
  if (!(ENVIRONMENTS as readonly string[]).includes(input.environment)) {
    throw new ValidationError(`unknown environment: ${String(input.environment)}`);
  }
  if (!UUID.test(String(input.changeId))) throw new ValidationError("invalid change id");
  if (!Number.isSafeInteger(input.expectedVersion)) throw new ValidationError("invalid version");
  return { ...input, ...validateValue(input), reason: validateReason(input.reason) };
}

const sameValue = (a: FlagValue, b: FlagValue) => a.enabled === b.enabled && a.rolloutPercentage === b.rolloutPercentage;
const valueOf = (row: FlagValue): FlagValue => ({ enabled: row.enabled, rolloutPercentage: row.rolloutPercentage });
const actorRef = (ctx: ActionContext) => ({ id: ctx.user.id, subject: ctx.user.subject });

/** A pure prod "off" with the rollout untouched: the kill switch, applied without approval. */
const isKill = (environment: FlagEnvironment, current: FlagValue, next: FlagValue) =>
  environment === "prod" && current.enabled && !next.enabled && next.rolloutPercentage === current.rolloutPercentage;

// ---------------------------------------------------------------------------
// Reads

export async function listFlags(db: Db, query: { q?: string } = {}): Promise<FlagListItem[]> {
  const q = query.q?.trim().slice(0, 100);
  const pattern = q ? `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
  const rows = await db
    .select()
    .from(flags)
    .where(pattern ? or(ilike(flags.key, pattern), ilike(flags.description, pattern)) : undefined)
    .orderBy(asc(flags.key));
  if (rows.length === 0) return [];
  const ids = rows.map((r) => r.id);
  const values = await db.select().from(flagValues).where(inArray(flagValues.flagId, ids));
  const pending = await db
    .select({ flagId: flagChanges.flagId })
    .from(flagChanges)
    .where(and(inArray(flagChanges.flagId, ids), eq(flagChanges.status, "pending")));
  const pendingIds = new Set(pending.map((p) => p.flagId));
  return rows.map((flag) => ({
    id: flag.id,
    key: flag.key,
    description: flag.description,
    values: Object.fromEntries(
      ENVIRONMENTS.map((env) => {
        const v = values.find((row) => row.flagId === flag.id && row.environment === env);
        return [env, v ? valueOf(v) : { enabled: false, rolloutPercentage: 0 }];
      }),
    ) as Record<FlagEnvironment, FlagValue>,
    hasPendingChange: pendingIds.has(flag.id),
  }));
}

async function loadChanges(db: Executor, where: SQL | undefined): Promise<FlagChangeView[]> {
  const rows = await db
    .select({
      change: flagChanges,
      flagKey: flags.key,
      requestedByName: users.username,
      approvalVersion: approvalRequests.version,
      approvalStatus: approvalRequests.status,
    })
    .from(flagChanges)
    .innerJoin(flags, eq(flags.id, flagChanges.flagId))
    .innerJoin(users, eq(users.id, flagChanges.requestedBy))
    .innerJoin(approvalRequests, eq(approvalRequests.id, flagChanges.approvalRequestId))
    .where(where)
    .orderBy(asc(flagChanges.requestedAt));
  return rows.map(({ change: c, flagKey, requestedByName, approvalVersion, approvalStatus }) => ({
    id: c.id,
    flagId: c.flagId,
    flagKey,
    environment: c.environment,
    before: { enabled: c.beforeEnabled, rolloutPercentage: c.beforeRolloutPercentage },
    after: { enabled: c.afterEnabled, rolloutPercentage: c.afterRolloutPercentage },
    reason: c.reason,
    status: c.status,
    requestedBy: c.requestedBy,
    requestedByName,
    requestedAt: c.requestedAt,
    approval: { id: c.approvalRequestId, version: approvalVersion, status: approvalStatus },
  }));
}

async function loadChange(db: Executor, changeId: string): Promise<FlagChangeView | null> {
  if (!UUID.test(changeId)) return null;
  return (await loadChanges(db, eq(flagChanges.id, changeId)))[0] ?? null;
}

export async function getFlagView(db: Db, flagId: string): Promise<FlagView | null> {
  if (!UUID.test(flagId)) return null;
  const [flag] = await db.select().from(flags).where(eq(flags.id, flagId));
  if (!flag) return null;
  const values = await db.select().from(flagValues).where(eq(flagValues.flagId, flag.id));
  const byEnv = Object.fromEntries(
    ENVIRONMENTS.map((env) => {
      const v = values.find((row) => row.environment === env);
      if (!v) throw new Error(`flag ${flag.key} has no ${env} value`);
      return [env, { ...valueOf(v), version: v.version, updatedAt: v.updatedAt }];
    }),
  ) as Record<FlagEnvironment, FlagEnvironmentValue>;
  const [pendingChange] = await loadChanges(db, and(eq(flagChanges.flagId, flag.id), eq(flagChanges.status, "pending")));
  return { id: flag.id, key: flag.key, description: flag.description, values: byEnv, pendingChange: pendingChange ?? null };
}

/** The flag's own audit rows plus its prod changes' approval rows, newest first. */
export async function flagHistory(db: Db, flagId: string): Promise<AuditListItem[]> {
  if (!UUID.test(flagId)) return [];
  const own = await listAuditForEntity(db, "flag", flagId);
  const approvals = await db
    .select({ id: flagChanges.approvalRequestId })
    .from(flagChanges)
    .where(eq(flagChanges.flagId, flagId));
  const approvalRows = (await Promise.all(approvals.map((a) => listAuditForEntity(db, "approval_request", a.id)))).flat();
  return [...own, ...approvalRows].sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime() || b.id - a.id);
}

export async function listPendingFlagChanges(ctx: ActionContext, query: { q?: string } = {}): Promise<FlagChangeView[]> {
  await requirePermission({ db: ctx.db, user: ctx.user, resource: "flags:approvals-queue" }, "flags:approve");
  const pending = await loadChanges(ctx.db, eq(flagChanges.status, "pending"));
  const term = query.q?.trim().toLowerCase();
  if (!term) return pending;
  return pending.filter((c) => [c.flagKey, c.reason, c.requestedByName].some((v) => v.toLowerCase().includes(term)));
}

/** What services see: current values only. Pending prod changes are not visible until applied. */
export async function serviceFlagValues(
  db: Db,
  environment: FlagEnvironment,
): Promise<{ environment: FlagEnvironment; flags: { key: string; enabled: boolean; rolloutPercentage: number }[] }> {
  const rows = await db
    .select({ key: flags.key, enabled: flagValues.enabled, rolloutPercentage: flagValues.rolloutPercentage })
    .from(flagValues)
    .innerJoin(flags, eq(flags.id, flagValues.flagId))
    .where(eq(flagValues.environment, environment))
    .orderBy(asc(flags.key));
  return { environment, flags: rows };
}

// ---------------------------------------------------------------------------
// Writes

interface FlagChangePayload {
  flagId: string;
  environment: FlagEnvironment;
  enabled: boolean;
  rolloutPercentage: number;
}

export const flagChangeApproval = defineApprovalKind<FlagChangePayload>({
  kind: "flag.prod_change",
  subjectType: "flag_change",
  requestPermission: "flags:request",
  approvePermission: "flags:approve",
});

/** Thrown inside the request transaction to roll it back when the same change id was already submitted. */
class AlreadySubmitted extends Error {}

/** Locks one environment's value so changes to it are checked one at a time. */
async function lockValue(tx: Tx, flagId: string, environment: FlagEnvironment): Promise<FlagValueRow> {
  const [row] = await tx
    .select()
    .from(flagValues)
    .where(and(eq(flagValues.flagId, flagId), eq(flagValues.environment, environment)))
    .for("update");
  if (!row) throw new NotFoundError(`flag ${flagId} not found`);
  return row;
}

/** Audit before/after for a value change. `after.previous` lets the Timeline show before -> after. */
const auditValues = (environment: FlagEnvironment, before: FlagValue, after: FlagValue, extra: Record<string, unknown> = {}) => ({
  before: { environment, ...before },
  after: { environment, ...after, previous: before, ...extra },
});

async function writeValue(
  tx: Tx,
  ctx: ActionContext,
  current: FlagValueRow,
  next: FlagValue,
  audit: { action: string; reason?: string; extra?: Record<string, unknown> },
): Promise<void> {
  await withAudit(
    tx,
    {
      actor: actorRef(ctx),
      action: audit.action,
      entityType: "flag",
      entityId: current.flagId,
      reason: audit.reason,
      ...auditValues(current.environment, valueOf(current), next, audit.extra),
    },
    async (t) => {
      const updated = await t
        .update(flagValues)
        .set({ ...next, version: current.version + 1, updatedAt: new Date(), updatedBy: ctx.user.id })
        .where(
          and(
            eq(flagValues.flagId, current.flagId),
            eq(flagValues.environment, current.environment),
            eq(flagValues.version, current.version),
          ),
        )
        .returning({ version: flagValues.version });
      if (updated.length !== 1) throw new ConflictError("flag value changed concurrently");
    },
  );
}

async function applyKill(ctx: ActionContext, flagId: string, reason: string): Promise<void> {
  await ctx.db.transaction(async (tx) => {
    const current = await lockValue(tx, flagId, "prod");
    if (!current.enabled) throw new ConflictError("this flag is already off in prod");
    await writeValue(tx, ctx, current, { enabled: false, rolloutPercentage: current.rolloutPercentage }, { action: "flag.killed", reason });
  });
}

/** Returns true for a resubmitted change id, or throws if the id was used for something else. */
/** The change this form already submitted (same `changeId`), if any. Different details are a conflict. */
async function findResubmission(db: Executor, ctx: ActionContext, input: FlagChangeInput): Promise<FlagChangeView | null> {
  const existing = await loadChange(db, input.changeId);
  if (!existing) return null;
  const same =
    existing.flagId === input.flagId &&
    existing.environment === input.environment &&
    sameValue(existing.after, input) &&
    existing.reason === input.reason &&
    existing.requestedBy === ctx.user.id;
  if (!same) throw new ConflictError(`change ${input.changeId} was already submitted with different details`);
  return existing;
}

/** What a resubmitted prod request reports: where its change got to, not a fresh "pending". */
function resubmittedOutcome(change: FlagChangeView): FlagChangeOutcome {
  if (change.status === "applied") return "applied";
  if (change.status === "rejected") throw new ConflictError("this prod request was rejected; prod is unchanged. Submit a new request.");
  return "pending_approval";
}

async function insertProdChange(tx: Tx, ctx: ActionContext, input: FlagChangeInput, approvalRequestId: string): Promise<void> {
  const current = await lockValue(tx, input.flagId, "prod");
  if (await findResubmission(tx, ctx, input)) throw new AlreadySubmitted();
  const [pending] = await tx
    .select({ id: flagChanges.id })
    .from(flagChanges)
    .where(and(eq(flagChanges.flagId, input.flagId), eq(flagChanges.environment, "prod"), eq(flagChanges.status, "pending")));
  if (pending) throw new ConflictError("a prod change for this flag is already waiting for approval");
  if (current.version !== input.expectedVersion) throw new ConflictError("prod changed since the page loaded");
  if (sameValue(current, input)) throw new ValidationError("that is already the prod value");
  const after = valueOf(input);
  await withAudit(
    tx,
    {
      actor: actorRef(ctx),
      action: "flag.change_requested",
      entityType: "flag",
      entityId: input.flagId,
      reason: input.reason,
      ...auditValues("prod", valueOf(current), after, { changeId: input.changeId }),
    },
    async (t) => {
      await t.insert(flagChanges).values({
        id: input.changeId,
        flagId: input.flagId,
        environment: "prod",
        beforeEnabled: current.enabled,
        beforeRolloutPercentage: current.rolloutPercentage,
        afterEnabled: after.enabled,
        afterRolloutPercentage: after.rolloutPercentage,
        baseVersion: current.version,
        reason: input.reason,
        approvalRequestId,
        requestedBy: ctx.user.id,
      });
    },
  );
}

/**
 * Changes one environment's value. dev and staging apply at once; turning prod off (rollout
 * untouched) is the kill switch and also applies at once; any other prod change is held for a
 * different person's approval.
 */
export async function changeFlag(ctx: ActionContext, rawInput: FlagChangeInput): Promise<{ outcome: FlagChangeOutcome; flag: FlagView }> {
  await requirePermission({ db: ctx.db, user: ctx.user, resource: "flags:change" }, "flags:request");
  const input = validateInput(rawInput);
  const view = async (outcome: FlagChangeOutcome) => {
    const flag = await getFlagView(ctx.db, input.flagId);
    if (!flag) throw new NotFoundError(`flag ${input.flagId} not found`);
    return { outcome, flag };
  };

  /** A resubmitted request reports its own result, and never claims a value prod no longer holds. */
  const resubmittedView = async (change: FlagChangeView) => {
    const result = await view(resubmittedOutcome(change));
    if (result.outcome === "applied" && !sameValue(result.flag.values.prod, change.after)) {
      throw new ConflictError("this request was applied earlier, but prod has changed since. Check the current value.");
    }
    return result;
  };

  const resubmitted = input.environment === "prod" ? await findResubmission(ctx.db, ctx, input) : null;
  if (resubmitted) return resubmittedView(resubmitted);
  const before = await getFlagView(ctx.db, input.flagId);
  if (!before) throw new NotFoundError(`flag ${input.flagId} not found`);
  const current = before.values[input.environment];
  if (sameValue(current, input)) throw new ValidationError(`that is already the ${input.environment} value`);

  if (isKill(input.environment, current, input)) {
    await applyKill(ctx, input.flagId, input.reason);
    return view("killed");
  }

  if (input.environment !== "prod") {
    await ctx.db.transaction(async (tx) => {
      const locked = await lockValue(tx, input.flagId, input.environment);
      if (locked.version !== input.expectedVersion) throw new ConflictError(`${input.environment} changed since the page loaded`);
      if (sameValue(locked, input)) throw new ValidationError(`that is already the ${input.environment} value`);
      await writeValue(tx, ctx, locked, valueOf(input), { action: "flag.value_changed", reason: input.reason });
    });
    return view("applied");
  }

  try {
    await requestApproval(
      ctx.db,
      ctx.user,
      { ...flagChangeApproval, onRequested: (tx, request) => insertProdChange(tx, ctx, input, request.id) },
      {
        subjectId: input.changeId,
        payload: { flagId: input.flagId, environment: "prod", enabled: input.enabled, rolloutPercentage: input.rolloutPercentage },
      },
    );
  } catch (err) {
    if (!(err instanceof AlreadySubmitted)) throw err;
    const existing = await loadChange(ctx.db, input.changeId);
    if (existing) return resubmittedView(existing);
  }
  return view("pending_approval");
}

/** The prod kill switch on its own: turns prod off, keeping the rollout, whatever the page showed. */
export async function killFlag(ctx: ActionContext, input: { flagId: string; reason: string }): Promise<FlagView> {
  await requirePermission({ db: ctx.db, user: ctx.user, resource: "flags:kill" }, "flags:request");
  if (!UUID.test(String(input.flagId))) throw new NotFoundError(`flag ${input.flagId} not found`);
  await applyKill(ctx, input.flagId, validateReason(input.reason));
  const flag = await getFlagView(ctx.db, input.flagId);
  if (!flag) throw new NotFoundError(`flag ${input.flagId} not found`);
  return flag;
}

/** Approval's effect, run by onApproved inside the decision's transaction. */
async function applyChange(tx: Tx, ctx: ActionContext, changeId: string): Promise<void> {
  const change = await loadChange(tx, changeId);
  if (!change) throw new NotFoundError(`change ${changeId} not found`);
  const current = await lockValue(tx, change.flagId, change.environment);
  const [row] = await tx.select({ status: flagChanges.status, baseVersion: flagChanges.baseVersion }).from(flagChanges).where(eq(flagChanges.id, changeId));
  if (row?.status !== "pending") throw new ConflictError(`change ${changeId} is already ${row?.status}`);
  if (current.version !== row.baseVersion) {
    throw new ConflictError("prod changed after this was requested, so it can't be applied. Reject it and request again.");
  }
  await writeValue(tx, ctx, current, change.after, { action: "flag.change_applied", extra: { changeId } });
  await markDecided(tx, changeId, "applied");
}

/** Rejection's effect, run by onRejected inside the decision's transaction. */
async function rejectChange(tx: Tx, ctx: ActionContext, changeId: string): Promise<void> {
  const change = await loadChange(tx, changeId);
  if (!change) throw new NotFoundError(`change ${changeId} not found`);
  await withAudit(
    tx,
    {
      actor: actorRef(ctx),
      action: "flag.change_rejected",
      entityType: "flag",
      entityId: change.flagId,
      ...auditValues(change.environment, change.before, change.after, { changeId }),
    },
    (t) => markDecided(t, changeId, "rejected"),
  );
}

async function markDecided(tx: Tx, changeId: string, status: "applied" | "rejected"): Promise<void> {
  const updated = await tx
    .update(flagChanges)
    .set({ status, decidedAt: new Date() })
    .where(and(eq(flagChanges.id, changeId), eq(flagChanges.status, "pending")))
    .returning({ id: flagChanges.id });
  if (updated.length !== 1) throw new ConflictError(`change ${changeId} is no longer pending`);
}

async function decide(
  ctx: ActionContext,
  input: { changeId: string; expectedVersion: number; note?: string },
  decision: "approve" | "reject",
): Promise<FlagChangeView> {
  const change = await loadChange(ctx.db, String(input.changeId));
  if (!change) throw new NotFoundError(`change ${input.changeId} not found`);
  await decideApproval(
    ctx.db,
    ctx.user,
    {
      ...flagChangeApproval,
      onApproved: (tx, request) => applyChange(tx, ctx, request.subjectId),
      onRejected: (tx, request) => rejectChange(tx, ctx, request.subjectId),
    },
    { id: change.approval.id, decision, note: input.note, expectedVersion: input.expectedVersion },
  );
  const decided = await loadChange(ctx.db, change.id);
  if (!decided) throw new Error(`change ${change.id} missing after decision`);
  return decided;
}

export const approveFlagChange = (ctx: ActionContext, input: { changeId: string; expectedVersion: number; note?: string }) =>
  decide(ctx, input, "approve");

export const rejectFlagChange = (ctx: ActionContext, input: { changeId: string; expectedVersion: number; note: string }) =>
  decide(ctx, input, "reject");
