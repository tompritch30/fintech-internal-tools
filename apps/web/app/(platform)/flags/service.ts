import { createHash, timingSafeEqual } from "node:crypto";
import type { Db, FlagEnvironment } from "@fit/db";
import { ENVIRONMENTS, serviceFlagValues, type FlagsServiceConfig } from "./flags.ts";

const digest = (s: string) => createHash("sha256").update(s).digest();

/** Compares hashes so the check takes the same time whatever the token's length or content. */
function tokenMatches(header: string | null, expected: string): boolean {
  const match = /^Bearer (\S+)$/.exec(header ?? "");
  return match?.[1] !== undefined && timingSafeEqual(digest(match[1]), digest(expected));
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "cache-control": "no-store", ...headers } });

/**
 * GET /api/flags?environment=prod with `Authorization: Bearer <FLAGS_SERVICE_TOKEN>`. Services
 * aren't platform users, so this is a shared token rather than a session; it can only read.
 */
export async function handleFlagsServiceRequest(db: Db, request: Request, config: FlagsServiceConfig): Promise<Response> {
  if (request.method !== "GET") return json(405, { error: "method not allowed" }, { allow: "GET" });
  if (!config.serviceToken) return json(503, { error: "the flags endpoint is not configured" });
  if (!tokenMatches(request.headers.get("authorization"), config.serviceToken)) {
    return json(401, { error: "unauthorised" }, { "www-authenticate": "Bearer" });
  }
  const environment = new URL(request.url).searchParams.get("environment");
  if (!(ENVIRONMENTS as readonly string[]).includes(environment ?? "")) {
    return json(400, { error: `environment must be one of ${ENVIRONMENTS.join(", ")}` });
  }
  return json(200, await serviceFlagValues(db, environment as FlagEnvironment));
}
