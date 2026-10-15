import type { Db, Tx } from "@fit/db";
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

export async function requestApproval<P>(
  _db: Db,
  _actor: SessionUser,
  _kind: ApprovalKind<P>,
  _input: { subjectId: string; payload: P },
): Promise<ApprovalRequest<P>> {
  throw new Error("not implemented");
}

export async function decideApproval<P>(
  _db: Db,
  _actor: SessionUser,
  _kind: ApprovalKind<P>,
  _input: { id: string; decision: "approve" | "reject"; note?: string; expectedVersion: number },
): Promise<ApprovalRequest<P>> {
  throw new Error("not implemented");
}

export async function cancelApproval(
  _db: Db,
  _actor: SessionUser,
  _input: { id: string; note: string },
): Promise<ApprovalRequest> {
  throw new Error("not implemented");
}
