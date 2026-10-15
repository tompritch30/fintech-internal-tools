import type { Db } from "@fit/db";
import { insertAuditRow } from "../audit/with-audit.ts";
import type { SessionUser } from "../session/session.ts";

/**
 * Writes the `access.denied` audit row for a blocked request.
 * Internal to core: callers write the row, then throw themselves.
 * Runs on its own (not inside a business transaction) so it survives the rejection.
 */
export async function recordAccessDenied(
  db: Db,
  user: SessionUser,
  resource: string,
  required: string,
): Promise<void> {
  await insertAuditRow(db, {
    actor: { id: user.id, subject: user.subject },
    action: "access.denied",
    entityType: "resource",
    entityId: resource,
    metadata: { required, roles: user.roles },
  });
}
