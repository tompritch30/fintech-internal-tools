import { createHash, timingSafeEqual } from "node:crypto";
import { and, count, eq, gte, sql } from "drizzle-orm";
import { withAudit } from "@fit/core";
import { auditLog, type Db, type FlagEnvironment } from "@fit/db";
import { ENVIRONMENTS, serviceFlagValues, type FlagsServiceConfig } from "./flags.ts";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Compares hashes so the check takes the same time whatever the token's length or content. */
function tokenMatches(header: string | null, expected: string): boolean {
  const match = /^Bearer (\S+)$/.exec(header ?? "");
  return match?.[1] !== undefined && timingSafeEqual(digest(match[1]), digest(expected));
}

const DENIED_RESOURCE = "api:flags";
/**
 * Refusals audited per window. The row that reaches it is marked `capped: true`. Past it the caller
 * still gets 401, and the refusals are counted and written as one `access.denied.suppressed` row
 * for the window once it ends, so the log stays bounded and no refusal goes unrecorded.
 */
export const DENIED_AUDIT_PER_MINUTE = 30;
export const DENIED_AUDIT_WINDOW_SECONDS = 60;

/** Refusals past the cap, by window start (epoch ms), waiting for their window to end. */
const suppressed = new Map<number, { count: number; windowSeconds: number }>();

const windowStartOf = (now: number, windowSeconds: number) => Math.floor(now / (windowSeconds * 1000)) * windowSeconds * 1000;

/** Writes one summary row for each window that has ended (or every window when `before` is null). */
async function flushSuppressed(db: Db, before: number | null) {
  const due = [...suppressed].filter(([start]) => before === null || start < before);
  for (const [start] of due) suppressed.delete(start);
  for (const [start, { count, windowSeconds }] of due) {
    try {
      await withAudit(
        db,
        {
          actor: { id: null, subject: null },
          action: "access.denied.suppressed",
          entityType: "resource",
          entityId: DENIED_RESOURCE,
          metadata: {
            required: "flags:service-token",
            suppressed: count,
            windowStart: new Date(start).toISOString(),
            windowEnd: new Date(start + windowSeconds * 1000).toISOString(),
          },
        },
        async () => undefined,
      );
    } catch (error) {
      const pending = suppressed.get(start);
      suppressed.set(start, { count: count + (pending?.count ?? 0), windowSeconds });
      throw error;
    }
  }
}

/**
 * Writes an access.denied row for a refused call. The caller is unauthenticated, so rows are
 * capped per window to stop anyone flooding the append-only log. The token is never stored.
 */
async function auditRefusal(db: Db, token: "missing" | "invalid", limit: number, windowSeconds: number) {
  const start = windowStartOf(Date.now(), windowSeconds);
  await db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`access.denied:${DENIED_RESOURCE}`}))`);
    const [recent] = await tx
      .select({ n: count() })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entityType, "resource"),
          eq(auditLog.entityId, DENIED_RESOURCE),
          eq(auditLog.action, "access.denied"),
          gte(auditLog.occurredAt, new Date(start)),
        ),
      );
    const n = recent?.n ?? 0;
    if (n >= limit) {
      const entry = suppressed.get(start);
      suppressed.set(start, { count: (entry?.count ?? 0) + 1, windowSeconds });
      if (!entry) {
        // Close the window out even if no further call arrives.
        setTimeout(() => void flushSuppressed(db, windowStartOf(Date.now(), windowSeconds)).catch(() => undefined), start + windowSeconds * 1000 - Date.now() + 100).unref();
      }
      return;
    }
    await withAudit(
      tx,
      {
        actor: { id: null, subject: null },
        action: "access.denied",
        entityType: "resource",
        entityId: DENIED_RESOURCE,
        metadata: { required: "flags:service-token", token, ...(n + 1 >= limit ? { capped: true } : {}) },
      },
      async () => undefined,
    );
  });
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

/**
 * GET /api/flags?environment=prod with `Authorization: Bearer <FLAGS_SERVICE_TOKEN>`. Services
 * aren't platform users, so this is a shared token rather than a session; it can only read.
 */
export async function handleFlagsServiceRequest(
  db: Db,
  request: Request,
  config: FlagsServiceConfig,
  {
    deniedAuditPerMinute = DENIED_AUDIT_PER_MINUTE,
    deniedAuditWindowSeconds = DENIED_AUDIT_WINDOW_SECONDS,
  }: { deniedAuditPerMinute?: number; deniedAuditWindowSeconds?: number } = {},
): Promise<Response> {
  // a summary that can't be written stays queued for the next call; it never blocks the read
  await flushSuppressed(db, windowStartOf(Date.now(), deniedAuditWindowSeconds)).catch(() => undefined);
  if (request.method !== "GET") return json(405, { error: "method not allowed" }, { allow: "GET" });
  if (!config.serviceToken) return json(503, { error: "the flags endpoint is not configured" });
  const authorization = request.headers.get("authorization");
  if (!tokenMatches(authorization, config.serviceToken)) {
    await auditRefusal(db, authorization ? "invalid" : "missing", deniedAuditPerMinute, deniedAuditWindowSeconds);
    return json(401, { error: "unauthorised" }, { "www-authenticate": "Bearer" });
  }
  const environment = new URL(request.url).searchParams.get("environment");
  if (!(ENVIRONMENTS as readonly string[]).includes(environment ?? "")) {
    return json(400, { error: `environment must be one of ${ENVIRONMENTS.join(", ")}` });
  }
  return json(200, await serviceFlagValues(db, environment as FlagEnvironment));
}
