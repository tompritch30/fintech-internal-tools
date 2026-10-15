import { and, asc, count, desc, eq, ilike, or, type SQL } from "drizzle-orm";
import { auditLog, users, type Db } from "@fit/db";

export interface AuditListItem {
  id: number;
  occurredAt: Date;
  actor: string | null;
  action: string;
  entityType: string;
  entityId: string;
  reason: string | null;
  after: unknown;
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

export async function listAudit(
  db: Db,
  opts: { search?: string; page?: number; pageSize?: number; dir?: "asc" | "desc" } = {},
): Promise<{ rows: AuditListItem[]; total: number }> {
  const pageSize = opts.pageSize ?? 25;
  const page = Math.max(1, opts.page ?? 1);
  const q = opts.search?.trim();
  const where: SQL | undefined = q
    ? or(
        ilike(auditLog.action, `%${q}%`),
        ilike(auditLog.entityType, `%${q}%`),
        ilike(auditLog.entityId, `%${q}%`),
        ilike(users.username, `%${q}%`),
      )
    : undefined;
  const rows = await db
    .select(columns)
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(where)
    .orderBy(opts.dir === "asc" ? asc(auditLog.id) : desc(auditLog.id))
    .limit(pageSize)
    .offset((page - 1) * pageSize);
  const [totalRow] = await db
    .select({ n: count() })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(where);
  return { rows, total: totalRow?.n ?? 0 };
}

/** Audit history for one record, newest first (feeds the Timeline component). */
export async function listAuditForEntity(db: Db, entityType: string, entityId: string): Promise<AuditListItem[]> {
  return db
    .select(columns)
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorUserId))
    .where(and(eq(auditLog.entityType, entityType), eq(auditLog.entityId, entityId)))
    .orderBy(desc(auditLog.id));
}
