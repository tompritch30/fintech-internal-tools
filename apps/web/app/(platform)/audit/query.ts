import "server-only";
import { and, asc, count, desc, eq, gte, ilike, lt, type SQL } from "drizzle-orm";
import type { AuditListItem } from "@fit/core";
import { auditLog, users, type Db } from "@fit/db";

/** Audit log filters, as they appear in the URL. Dates are UTC days (YYYY-MM-DD), both ends inclusive. */
export interface AuditFilters {
  from?: string;
  to?: string;
  user?: string;
  action?: string;
  recordType?: string;
  recordId?: string;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LENGTH = 200;

function day(value: string | undefined): Date | undefined {
  if (!value || !DAY.test(value)) return undefined;
  const d = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value ? undefined : d;
}

/** A URL search param; repeated keys arrive as an array, and only the first is used. */
export type SearchParam = string | string[] | undefined;
const first = (v: SearchParam) => (Array.isArray(v) ? v[0] : v);

const text = (param: SearchParam) => {
  const v = first(param)?.trim().slice(0, MAX_LENGTH);
  return v ? v : undefined;
};

/** Keeps only well-formed filters; anything else is dropped rather than guessed at. */
export function parseAuditFilters(params: Record<string, SearchParam>): AuditFilters {
  const from = first(params.from);
  const to = first(params.to);
  return {
    from: day(from) ? from : undefined,
    to: day(to) ? to : undefined,
    user: text(params.user),
    action: text(params.action),
    recordType: text(params.recordType),
    recordId: text(params.recordId),
  };
}

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function where(f: AuditFilters): SQL | undefined {
  const from = day(f.from);
  const to = day(f.to);
  return and(
    from ? gte(auditLog.occurredAt, from) : undefined,
    to ? lt(auditLog.occurredAt, new Date(to.getTime() + 86_400_000)) : undefined,
    f.user ? eq(users.username, f.user) : undefined,
    f.action ? eq(auditLog.action, f.action) : undefined,
    f.recordType ? eq(auditLog.entityType, f.recordType) : undefined,
    f.recordId ? ilike(auditLog.entityId, `${escapeLike(f.recordId)}%`) : undefined,
  );
}

const columns = {
  id: auditLog.id,
  occurredAt: auditLog.occurredAt,
  actor: users.username,
  action: auditLog.action,
  entityType: auditLog.entityType,
  entityId: auditLog.entityId,
  reason: auditLog.reason,
  after: auditLog.after,
};

/** Read-only audit search for the audit log page. The caller checks `audit:read`. */
export async function searchAudit(
  db: Db,
  filters: AuditFilters,
  opts: { page: number; pageSize: number; dir: "asc" | "desc" },
): Promise<{ rows: AuditListItem[]; total: number }> {
  const w = where(filters);
  const order = opts.dir === "asc" ? [asc(auditLog.occurredAt), asc(auditLog.id)] : [desc(auditLog.occurredAt), desc(auditLog.id)];
  const rows = await db
    .select(columns)
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(w)
    .orderBy(...order)
    .limit(opts.pageSize)
    .offset((Math.max(1, opts.page) - 1) * opts.pageSize);
  const [total] = await db.select({ n: count() }).from(auditLog).leftJoin(users, eq(users.id, auditLog.actorUserId)).where(w);
  return { rows, total: total?.n ?? 0 };
}

/** Values for the user, action and record-type dropdowns. */
export async function auditFilterOptions(db: Db): Promise<{ users: string[]; actions: string[]; recordTypes: string[] }> {
  const [u, a, t] = await Promise.all([
    db.selectDistinct({ v: users.username }).from(auditLog).innerJoin(users, eq(users.id, auditLog.actorUserId)).orderBy(users.username),
    db.selectDistinct({ v: auditLog.action }).from(auditLog).orderBy(auditLog.action),
    db.selectDistinct({ v: auditLog.entityType }).from(auditLog).orderBy(auditLog.entityType),
  ]);
  return { users: u.map((r) => r.v), actions: a.map((r) => r.v), recordTypes: t.map((r) => r.v) };
}
