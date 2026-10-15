import { auditLog, type Executor, type Tx } from "@fit/db";

export interface Actor {
  id: string | null;
  subject: string | null;
}

export interface AuditEntry {
  actor: Actor;
  action: string;
  entityType: string;
  entityId: string;
  reason?: string | null;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
}

/** Inserts one audit row. Internal to core: apps use withAudit. */
export async function insertAuditRow(executor: Executor, entry: AuditEntry): Promise<void> {
  await executor.insert(auditLog).values({
    actorUserId: entry.actor.id,
    actorSubject: entry.actor.subject,
    action: entry.action,
    entityType: entry.entityType,
    entityId: entry.entityId,
    reason: entry.reason ?? null,
    before: entry.before ?? null,
    after: entry.after ?? null,
    metadata: entry.metadata ?? null,
  });
}

/**
 * Runs `fn` and writes its audit row in the same transaction.
 * If `fn` or the audit insert throws, both roll back.
 * Pass an entry, or a function that builds the entry from `fn`'s result
 * (for example to record the new row's id and `after` state).
 * Given an open transaction, it uses a savepoint inside it.
 */
export async function withAudit<T>(
  executor: Executor,
  entry: AuditEntry | ((result: NoInfer<T>) => AuditEntry),
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return executor.transaction(async (tx) => {
    const result = await fn(tx);
    await insertAuditRow(tx, typeof entry === "function" ? entry(result) : entry);
    return result;
  });
}
