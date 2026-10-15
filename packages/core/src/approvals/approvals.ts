import { and, eq, sql } from "drizzle-orm";
import { approvalRequests, type ApprovalRequestRow, type Db, type Tx } from "@fit/db";
import { withAudit } from "../audit/with-audit.ts";
import { recordAccessDenied } from "../rbac/denial.ts";
import { requirePermission } from "../rbac/guards.ts";
import { ConflictError, ForbiddenError, NotFoundError, SelfApprovalError, ValidationError } from "../errors.ts";
import type { Permission } from "../rbac/permissions.ts";
import type { SessionUser } from "../session/session.ts";

export type ApprovalStatus = "pending" | "approved" | "rejected" | "cancelled";

export interface ApprovalRequest<P = unknown> {
  id: string;
  kind: string;
  subjectType: string;
  subjectId: string;
  payload: P;
  status: ApprovalStatus;
  requestedBy: string;
  requestedAt: Date;
  decidedBy: string | null;
  decidedAt: Date | null;
  decisionNote: string | null;
  version: number;
}

export interface ApprovalKind<P = unknown> {
  kind: string;
  subjectType: string;
  requestPermission: Permission;
  approvePermission: Permission;
  /** Runs in the request's transaction: create the app's record here so record + request commit together. */
  onRequested?: (tx: Tx, request: ApprovalRequest<P>) => Promise<void>;
  /** Runs in the approval's transaction: apply the effect so "approved" + effect commit together. */
  onApproved?: (tx: Tx, request: ApprovalRequest<P>) => Promise<void>;
}

type NonJson =
  | undefined
  | bigint
  | symbol
  | Date
  | Map<unknown, unknown>
  | Set<unknown>
  | RegExp
  | ((...args: never[]) => unknown);

/**
 * Whether T (or a union member, element or property, recursively) can't round-trip
 * through JSON. Optional properties are fine — an absent value stays absent.
 * The array branch runs before the object branch so array methods aren't scanned.
 */
type HasNonJson<T> = T extends NonJson
  ? true
  : T extends readonly (infer U)[]
    ? HasNonJson<U>
    : T extends object
      ? true extends { [K in keyof T]-?: HasNonJson<NonNullable<T[K]>> }[keyof T]
        ? true
        : false
      : false;

/** Payloads are stored as JSONB; types JSON can't round-trip are refused. */
type JsonPayload<P> = true extends HasNonJson<P> ? { readonly payloadMustBeJsonSafe: never } : unknown;

/**
 * Runtime counterpart of JsonPayload: payloads must survive a JSON round-trip.
 * `ancestors` tracks the objects on the current path (not a global seen-set:
 * reusing one object twice is fine, only cycles are unsafe). Holes in sparse
 * arrays become null in JSONB, so they're unsafe too.
 */
function isJsonSafe(value: unknown, ancestors: Set<object> = new Set()): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object": {
      if (ancestors.has(value)) return false;
      ancestors.add(value);
      try {
        if (Array.isArray(value)) {
          for (let i = 0; i < value.length; i++) {
            if (!(i in value) || !isJsonSafe(value[i], ancestors)) return false;
          }
          return true;
        }
        if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return false;
        return Object.values(value).every((v) => v === undefined || isJsonSafe(v, ancestors));
      } finally {
        ancestors.delete(value);
      }
    }
    default:
      return false;
  }
}

/** Declares an approval kind next to the app that owns the subject type. */
export function defineApprovalKind<P>(def: ApprovalKind<P> & JsonPayload<P>): ApprovalKind<P> {
  return def;
}

function toRequest<P>(row: ApprovalRequestRow): ApprovalRequest<P> {
  return {
    id: row.id,
    kind: row.kind,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    payload: row.payload as P,
    status: row.status,
    requestedBy: row.requestedBy,
    requestedAt: row.requestedAt,
    decidedBy: row.decidedBy,
    decidedAt: row.decidedAt,
    decisionNote: row.decisionNote,
    version: row.version,
  };
}

async function loadRow(db: Db, id: string): Promise<ApprovalRequestRow> {
  const [row] = await db.select().from(approvalRequests).where(eq(approvalRequests.id, id));
  if (!row) throw new NotFoundError(`approval request ${id} not found`);
  return row;
}

// Payloads never go into audit rows: the row references the request id instead.
const meta = (row: ApprovalRequestRow) => ({ kind: row.kind, subjectType: row.subjectType, subjectId: row.subjectId });
const state = (row: ApprovalRequestRow | ApprovalRequest) => ({ status: row.status, version: row.version });
const actorRef = (actor: SessionUser) => ({ id: actor.id, subject: actor.subject });

export async function requestApproval<P>(
  db: Db,
  actor: SessionUser,
  kind: ApprovalKind<P> & JsonPayload<P>,
  input: { subjectId: string; payload: P },
): Promise<ApprovalRequest<P>> {
  // Untrusted input: payloads go to JSONB, so refuse anything JSON can't round-trip.
  if (!isJsonSafe(input.payload)) {
    throw new ValidationError("approval payload must be JSON-safe (no Date, bigint, Map, class instances, NaN/Infinity)");
  }
  await requirePermission({ db, user: actor, resource: `approval-kind:${kind.kind}` }, kind.requestPermission);
  return withAudit(
    db,
    (request) => ({
      actor: actorRef(actor),
      action: "approval.requested",
      entityType: "approval_request",
      entityId: request.id,
      reason: null,
      after: state(request),
      metadata: { kind: kind.kind, subjectType: kind.subjectType, subjectId: input.subjectId },
    }),
    async (tx) => {
      const [row] = await tx
        .insert(approvalRequests)
        .values({ kind: kind.kind, subjectType: kind.subjectType, subjectId: input.subjectId, payload: input.payload, requestedBy: actor.id })
        .returning();
      if (!row) throw new Error("approval request insert returned no row");
      const request = toRequest<P>(row);
      await kind.onRequested?.(tx, request);
      return request;
    },
  );
}

export async function decideApproval<P>(
  db: Db,
  actor: SessionUser,
  kind: ApprovalKind<P>,
  input: { id: string; decision: "approve" | "reject"; note?: string; expectedVersion: number },
): Promise<ApprovalRequest<P>> {
  // Untrusted input: anything but the two literal decisions is invalid, before any DB access.
  if (input.decision !== "approve" && input.decision !== "reject") {
    throw new ValidationError(`invalid approval decision: ${String(input.decision)}`);
  }
  const note = input.note?.trim() || null;
  if (input.decision === "reject" && !note) throw new ValidationError("rejecting an approval requires a note");
  const row = await loadRow(db, input.id);
  if (row.kind !== kind.kind) {
    throw new ValidationError(`approval request ${row.id} has kind ${row.kind}, not ${kind.kind}`);
  }
  // Denials are written on their own, before the transaction, so they survive.
  if (actor.id === row.requestedBy) {
    await recordAccessDenied(db, actor, `approval:${row.id}`, "approval:not-requester");
    throw new SelfApprovalError();
  }
  await requirePermission({ db, user: actor, resource: `approval:${row.id}` }, kind.approvePermission);
  if (row.status !== "pending") throw new ConflictError(`approval request ${row.id} is already ${row.status}`);
  const status = input.decision === "approve" ? ("approved" as const) : ("rejected" as const);
  return withAudit(
    db,
    (updated) => ({
      actor: actorRef(actor),
      action: input.decision === "approve" ? "approval.approved" : "approval.rejected",
      entityType: "approval_request",
      entityId: row.id,
      reason: note,
      before: state(row),
      after: state(updated),
      metadata: meta(row),
    }),
    async (tx) => {
      const [updated] = await tx
        .update(approvalRequests)
        .set({
          status,
          decidedBy: actor.id,
          decidedAt: sql`now()`,
          decisionNote: note,
          version: sql`${approvalRequests.version} + 1`,
        })
        .where(and(eq(approvalRequests.id, row.id), eq(approvalRequests.status, "pending"), eq(approvalRequests.version, input.expectedVersion)))
        .returning();
      if (!updated) {
        throw new ConflictError(`approval request ${row.id} changed since version ${input.expectedVersion}`);
      }
      const request = toRequest<P>(updated);
      if (status === "approved") await kind.onApproved?.(tx, request);
      return request;
    },
  );
}

export async function cancelApproval(
  db: Db,
  actor: SessionUser,
  input: { id: string; note: string },
): Promise<ApprovalRequest> {
  const note = input.note.trim();
  if (!note) throw new ValidationError("cancelling an approval requires a note");
  const row = await loadRow(db, input.id);
  if (actor.id !== row.requestedBy) {
    await recordAccessDenied(db, actor, `approval:${row.id}`, "approval:requester-only");
    throw new ForbiddenError("approval:requester-only");
  }
  if (row.status !== "pending") throw new ConflictError(`approval request ${row.id} is already ${row.status}`);
  return withAudit(
    db,
    (updated) => ({
      actor: actorRef(actor),
      action: "approval.cancelled",
      entityType: "approval_request",
      entityId: row.id,
      reason: note,
      before: state(row),
      after: state(updated),
      metadata: meta(row),
    }),
    async (tx) => {
      const [updated] = await tx
        .update(approvalRequests)
        .set({ status: "cancelled", decidedAt: sql`now()`, decisionNote: note, version: sql`${approvalRequests.version} + 1` })
        .where(and(eq(approvalRequests.id, row.id), eq(approvalRequests.status, "pending")))
        .returning();
      if (!updated) throw new ConflictError(`approval request ${row.id} changed since it was read`);
      return toRequest(updated);
    },
  );
}
