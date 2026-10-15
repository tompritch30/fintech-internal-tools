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

/** Declares an approval kind next to the app that owns the subject type. */
export function defineApprovalKind<P>(def: ApprovalKind<P>): ApprovalKind<P> {
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
  kind: ApprovalKind<P>,
  input: { subjectId: string; payload: P },
): Promise<ApprovalRequest<P>> {
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
