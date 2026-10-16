import { eq, inArray, sql } from "drizzle-orm";
import type { AuditListItem } from "@fit/core";
import { auditLog, users, type Db } from "@fit/db";

/** Adds each audit row's actor display name, looked up by the row's own actor (usernames aren't unique). */
export async function withActorNames<T extends Pick<AuditListItem, "id" | "actor">>(
  db: Db,
  items: T[],
): Promise<(T & { actorName: string | null })[]> {
  const ids = items.filter((i) => i.actor !== null).map((i) => i.id);
  const rows = ids.length
    ? await db
        .select({ id: auditLog.id, name: sql<string>`coalesce(${users.displayName}, ${users.username})` })
        .from(auditLog)
        .innerJoin(users, eq(users.id, auditLog.actorUserId))
        .where(inArray(auditLog.id, ids))
    : [];
  const names = new Map(rows.map((r) => [r.id, r.name]));
  return items.map((i) => ({ ...i, actorName: i.actor === null ? null : (names.get(i.id) ?? i.actor) }));
}
