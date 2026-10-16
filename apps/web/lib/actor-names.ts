import { inArray } from "drizzle-orm";
import type { AuditListItem } from "@fit/core";
import { users, type Db } from "@fit/db";

/**
 * Adds each history row's display name (`actorName`, falling back to the username).
 * `actor` stays the username, for hover. Core's audit queries return usernames only.
 */
export async function withActorNames<T extends Pick<AuditListItem, "actor">>(db: Db, items: T[]): Promise<(T & { actorName: string | null })[]> {
  const usernames = [...new Set(items.map((i) => i.actor).filter((a): a is string => a !== null))];
  const rows = usernames.length
    ? await db.select({ username: users.username, displayName: users.displayName }).from(users).where(inArray(users.username, usernames))
    : [];
  const names = new Map(rows.map((r) => [r.username, r.displayName ?? r.username]));
  return items.map((i) => ({ ...i, actorName: i.actor === null ? null : (names.get(i.actor) ?? i.actor) }));
}
