import { createHash, timingSafeEqual } from "node:crypto";
import { and, count, eq, gt, sql } from "drizzle-orm";
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
 * Refusals audited per rolling minute. The row that reaches it is marked `capped: true`, so the log
 * shows refusals carried on; past it the caller still gets 401 but no new row.
 */
export const DENIED_AUDIT_PER_MINUTE = 30;

/**
 * Writes an access.denied row for a refused call. The caller is unauthenticated, so rows are
 * capped per minute to stop anyone flooding the append-only log. The token is never stored.
 */
async function auditRefusal(db: Db, token: "missing" | "invalid", limit: number) {
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
          gt(auditLog.occurredAt, sql`clock_timestamp() - interval '1 minute'`),
        ),
      );
    const n = recent?.n ?? 0;
    if (n >= limit) return;
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
  { deniedAuditPerMinute = DENIED_AUDIT_PER_MINUTE }: { deniedAuditPerMinute?: number } = {},
): Promise<Response> {
  if (request.method !== "GET") return json(405, { error: "method not allowed" }, { allow: "GET" });
  if (!config.serviceToken) return json(503, { error: "the flags endpoint is not configured" });
  const authorization = request.headers.get("authorization");
  if (!tokenMatches(authorization, config.serviceToken)) {
    await auditRefusal(db, authorization ? "invalid" : "missing", deniedAuditPerMinute);
    return json(401, { error: "unauthorised" }, { "www-authenticate": "Bearer" });
  }
  const environment = new URL(request.url).searchParams.get("environment");
  if (!(ENVIRONMENTS as readonly string[]).includes(environment ?? "")) {
    return json(400, { error: `environment must be one of ${ENVIRONMENTS.join(", ")}` });
  }
  return json(200, await serviceFlagValues(db, environment as FlagEnvironment));
}
