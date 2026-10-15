import type { ActionContext, AuditListItem } from "@fit/core";
import type { Db, FlagEnvironment } from "@fit/db";

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
  serviceToken: string | null;
}

const notImplemented = (): never => {
  throw new Error("not implemented");
};

export function loadFlagsServiceConfig(_env: Record<string, string | undefined> = process.env): FlagsServiceConfig {
  return notImplemented();
}
export function parseRolloutPercentage(_raw: string): number {
  return notImplemented();
}
export async function listFlags(_db: Db, _query: { q?: string } = {}): Promise<FlagListItem[]> {
  return notImplemented();
}
export async function getFlagView(_db: Db, _flagId: string): Promise<FlagView | null> {
  return notImplemented();
}
export async function flagHistory(_db: Db, _flagId: string): Promise<AuditListItem[]> {
  return notImplemented();
}
export async function listPendingFlagChanges(_ctx: ActionContext): Promise<FlagChangeView[]> {
  return notImplemented();
}
export async function changeFlag(_ctx: ActionContext, _input: FlagChangeInput): Promise<{ outcome: FlagChangeOutcome; flag: FlagView }> {
  return notImplemented();
}
export async function approveFlagChange(
  _ctx: ActionContext,
  _input: { changeId: string; expectedVersion: number; note?: string },
): Promise<FlagChangeView> {
  return notImplemented();
}
export async function rejectFlagChange(
  _ctx: ActionContext,
  _input: { changeId: string; expectedVersion: number; note: string },
): Promise<FlagChangeView> {
  return notImplemented();
}
export async function serviceFlagValues(
  _db: Db,
  _environment: FlagEnvironment,
): Promise<{ environment: FlagEnvironment; flags: { key: string; enabled: boolean; rolloutPercentage: number }[] }> {
  return notImplemented();
}
