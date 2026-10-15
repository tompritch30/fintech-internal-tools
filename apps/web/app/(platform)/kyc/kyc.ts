import type { ActionContext, AuditListItem } from "@fit/core";
import type { Db } from "@fit/db";

// Stub for the red-first test commit: every export throws until the implementation lands.

export interface KycConfig {
  /** Closed cases are kept (no delete) for this many years after closing. */
  retentionYears: number;
}

export const DEFAULT_RETENTION_YEARS = 5;
export const MIN_RETENTION_YEARS = 5;

export type KycStatus = "open" | "in_review" | "pending_approval" | "escalated" | "approved" | "rejected";
export type KycDecision = "approve" | "reject" | "escalate";
export type KycMaskedField = "applicantName" | "dateOfBirth" | "idNumber" | "address";

export interface KycCaseListItem {
  id: string;
  reference: string;
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
  dateOfBirth: string;
  idNumber: string;
  address: string;
  claimedAt: Date | null;
  decisionNote: string | null;
  closedAt: Date | null;
  retentionUntil: Date | null;
  documents: { id: string; kind: string; fileName: string }[];
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

const todo = (): never => {
  throw new Error("not implemented");
};

export function loadKycConfig(_env: Record<string, string | undefined> = process.env): KycConfig {
  return todo();
}

export function isHighRisk(_c: { riskRating: string; sanctionsHit: boolean; pep: boolean }): boolean {
  return todo();
}

export async function listKycCases(_ctx: ActionContext, _query: KycListQuery): Promise<{ rows: KycCaseListItem[]; total: number }> {
  return todo();
}

export async function getKycCase(_ctx: ActionContext, _caseId: string): Promise<KycCaseView | null> {
  return todo();
}

export async function claimCase(_ctx: ActionContext, _input: { caseId: string }): Promise<KycCaseView> {
  return todo();
}

export async function decideCase(
  _ctx: ActionContext,
  _input: { caseId: string; decision: KycDecision; note?: string },
  _config?: KycConfig,
): Promise<KycCaseView> {
  return todo();
}

export async function signOffCase(
  _ctx: ActionContext,
  _input: { caseId: string; decision: "approve" | "reject"; note?: string; expectedVersion: number },
  _config?: KycConfig,
): Promise<KycCaseView> {
  return todo();
}

export async function revealCaseField(
  _ctx: ActionContext,
  _input: { caseId: string; field: KycMaskedField; reason: string },
): Promise<string | null> {
  return todo();
}

export async function openCaseDocument(
  _ctx: ActionContext,
  _input: { documentId: string; reason: string },
): Promise<{ id: string; kind: string; fileName: string; content: string }> {
  return todo();
}

export async function caseHistory(_db: Db, _caseId: string): Promise<AuditListItem[]> {
  return todo();
}
