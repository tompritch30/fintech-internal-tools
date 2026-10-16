import "server-only";
import { and, asc, count, desc, eq, gte, ilike, lt, or, sql, type SQL } from "drizzle-orm";
import { requirePermission, withAudit, type AuditListItem, type SessionUser } from "@fit/core";
import { auditLog, users, type Db, type Executor } from "@fit/db";

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
export const first = (v: SearchParam) => (Array.isArray(v) ? v[0] : v);

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

const type = auditLog.entityType;
const id = auditLog.entityId;
const UUID_RE = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
/** entity_id as a uuid (null when it isn't one), so the lookups below use primary keys. */
const asUuid = (text: SQL | typeof id) => sql`(case when ${text} ~* ${UUID_RE} then (${text})::uuid end)`;
const uid = asUuid(id);
const subjectUid = asUuid(sql.raw("a.subject_id"));

/** The ID people use for the record (PAY-, KYC-, flag key), or null if it isn't a known record. */
const recordLabel = sql<string | null>`case ${type}
  when 'payment' then (select p.reference from payments p where p.id = ${uid})
  when 'refund' then (select 'Refund on ' || p.reference from refunds r join payments p on p.id = r.payment_id where r.id = ${uid})
  when 'kyc_case' then (select c.reference from kyc_cases c where c.id = ${uid})
  when 'kyc_document' then (select c.reference || ' document' from kyc_documents d join kyc_cases c on c.id = d.case_id where d.id = ${uid})
  when 'flag' then (select f.key from flags f where f.id = ${uid})
  when 'user' then (select u.username from users u where u.id = ${uid})
  when 'approval_request' then (select case a.subject_type
      when 'refund' then (select 'Approval for refund on ' || p.reference from refunds r join payments p on p.id = r.payment_id where r.id = ${subjectUid})
      when 'kyc_case' then (select 'Approval for ' || c.reference from kyc_cases c where c.id = ${subjectUid})
      when 'flag_change' then (select 'Approval for ' || f.key from flag_changes fc join flags f on f.id = fc.flag_id where fc.id = ${subjectUid})
    end from approval_requests a where a.id = ${uid})
end`;

/** The page that shows the record, if there is one. */
const recordHref = sql<string | null>`case ${type}
  when 'payment' then (select '/refunds/payments/' || p.id from payments p where p.id = ${uid})
  when 'refund' then (select '/refunds/requests/' || r.id from refunds r where r.id = ${uid})
  when 'kyc_case' then (select '/kyc/cases/' || c.id from kyc_cases c where c.id = ${uid})
  when 'kyc_document' then (select '/kyc/cases/' || d.case_id from kyc_documents d where d.id = ${uid})
  when 'flag' then (select '/flags/' || f.id from flags f where f.id = ${uid})
  when 'approval_request' then (select case a.subject_type
      when 'refund' then '/refunds/requests/' || a.subject_id
      when 'kyc_case' then '/kyc/cases/' || a.subject_id
      when 'flag_change' then (select '/flags/' || fc.flag_id from flag_changes fc where fc.id = ${subjectUid})
    end from approval_requests a where a.id = ${uid})
end`;

/** IDs of the records whose human ID (PAY-, KYC-, flag key, username) matches, plus their approvals. */
function recordIdsMatching(pattern: string): SQL {
  const refunds = sql`select r.id::text from refunds r join payments p on p.id = r.payment_id where p.reference ilike ${pattern}`;
  const cases = sql`select c.id::text from kyc_cases c where c.reference ilike ${pattern}`;
  const changes = sql`select fc.id::text from flag_changes fc join flags f on f.id = fc.flag_id where f.key ilike ${pattern}`;
  return sql`select p.id::text from payments p where p.reference ilike ${pattern}
    union all ${refunds}
    union all ${cases}
    union all select d.id::text from kyc_documents d join kyc_cases c on c.id = d.case_id where c.reference ilike ${pattern}
    union all select f.id::text from flags f where f.key ilike ${pattern}
    union all select u.id::text from users u where u.username ilike ${pattern}
    union all select a.id::text from approval_requests a where a.subject_id in (${refunds} union all ${cases} union all ${changes})`;
}

function where(f: AuditFilters): SQL | undefined {
  const from = day(f.from);
  const to = day(f.to);
  const q = f.recordId ? escapeLike(f.recordId) : undefined;
  return and(
    from ? gte(auditLog.occurredAt, from) : undefined,
    to ? lt(auditLog.occurredAt, new Date(to.getTime() + 86_400_000)) : undefined,
    f.user ? eq(users.username, f.user) : undefined,
    f.action ? eq(auditLog.action, f.action) : undefined,
    f.recordType ? eq(auditLog.entityType, f.recordType) : undefined,
    q ? or(ilike(auditLog.entityId, `${q}%`), sql`${auditLog.entityId} in (${recordIdsMatching(`%${q}%`)})`) : undefined,
  );
}

/** An audit row as the audit page shows it: who by display name, and the record by the ID people use. */
export interface AuditRow extends AuditListItem {
  actorName: string | null;
  actorUsername: string | null;
  recordLabel: string | null;
  recordHref: string | null;
}

const columns = {
  id: auditLog.id,
  occurredAt: auditLog.occurredAt,
  actor: users.username,
  actorName: sql<string | null>`coalesce(${users.displayName}, ${users.username})`,
  actorUsername: users.username,
  action: auditLog.action,
  entityType: auditLog.entityType,
  entityId: auditLog.entityId,
  recordLabel,
  recordHref,
  reason: auditLog.reason,
  after: auditLog.after,
};

/** Read-only audit search for the audit log page. The caller checks `audit:read`. */
export async function searchAudit(
  db: Executor,
  filters: AuditFilters,
  opts: { page: number; pageSize: number; dir: "asc" | "desc" },
): Promise<{ rows: AuditRow[]; total: number }> {
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

/** One CSV cell: always quoted, and a leading = + - @ tab or CR is defused so spreadsheets don't run it. */
export function csvCell(value: string | number | null | undefined): string {
  let s = value == null ? "" : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

const csvLine = (cells: (string | number | null | undefined)[]) => cells.map(csvCell).join(",");

/** Most rows one export holds; past that the file says it was cut off. */
export const EXPORT_LIMIT = 10_000;

/** CSV of the filtered audit view. Needs `audit:read`; the export itself is written to the audit log. */
export async function exportAudit(
  ctx: { db: Db; user: SessionUser },
  filters: AuditFilters,
  limit: number = EXPORT_LIMIT,
): Promise<{ csv: string; rowCount: number; truncated: boolean }> {
  const user = await requirePermission({ db: ctx.db, user: ctx.user, resource: "/audit/export" }, "audit:read");
  return withAudit(
    ctx.db,
    (r) => ({
      actor: { id: user.id, subject: user.subject },
      action: "audit.exported",
      entityType: "audit_log",
      entityId: "export",
      metadata: { filters, rowCount: r.rowCount, truncated: r.truncated },
    }),
    async (tx) => {
      const { rows, total } = await searchAudit(tx, filters, { page: 1, pageSize: limit, dir: "desc" });
      const lines = [
        csvLine(["When (UTC)", "Who", "Username", "Action", "Record type", "Record", "Record ID", "Reason"]),
        ...rows.map((r) =>
          csvLine([r.occurredAt.toISOString().replace("T", " ").slice(0, 19), r.actorName ?? "system", r.actorUsername, r.action, r.entityType, r.recordLabel, r.entityId, r.reason]),
        ),
      ];
      const truncated = total > rows.length;
      if (truncated) lines.push(csvLine([`Cut off: these are the newest ${rows.length} of ${total} rows. Narrow the filters to export the rest.`]));
      return { csv: `${lines.join("\r\n")}\r\n`, rowCount: rows.length, truncated };
    },
  );
}

/** Values for the user, action and record-type dropdowns. Users are listed by display name. */
export async function auditFilterOptions(
  db: Db,
): Promise<{ users: { value: string; label: string }[]; actions: string[]; recordTypes: string[] }> {
  const [u, a, t] = await Promise.all([
    db
      .selectDistinct({ value: users.username, label: sql<string>`coalesce(${users.displayName}, ${users.username})` })
      .from(auditLog)
      .innerJoin(users, eq(users.id, auditLog.actorUserId))
      .orderBy(sql`2`, users.username),
    db.selectDistinct({ v: auditLog.action }).from(auditLog).orderBy(auditLog.action),
    db.selectDistinct({ v: auditLog.entityType }).from(auditLog).orderBy(auditLog.entityType),
  ]);
  return { users: u, actions: a.map((r) => r.v), recordTypes: t.map((r) => r.v) };
}
