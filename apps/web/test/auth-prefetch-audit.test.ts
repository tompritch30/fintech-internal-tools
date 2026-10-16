import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { auditLog, createDb } from "@fit/db";
import { appDb, makeUser } from "../../../packages/core/test/helpers/db.ts";
import { TEST_DATABASE_URL } from "../../../packages/core/test/helpers/env.ts";

const mocks = vi.hoisted(() => ({
  requestHeaders: {} as Record<string, string>,
  sessionToken: "",
}));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", async () => {
  const { sessionCookie } = await import("@fit/core/cookie");
  const SESSION_COOKIE = sessionCookie(process.env.APP_URL ?? "http://localhost:3000").name;
  return {
    cookies: async () => ({
      get: (name: string) => (name === SESSION_COOKIE && mocks.sessionToken ? { value: mocks.sessionToken } : undefined),
    }),
    headers: async () => new Headers(mocks.requestHeaders),
  };
});

vi.mock("next/navigation", () => ({
  redirect: (destination: string): never => {
    throw new Error(`redirect:${destination}`);
  },
}));

const db = appDb();
const authDb = createDb(TEST_DATABASE_URL, { max: 1 });
afterAll(() => authDb.$client.end());

const prefetchHeaders: Record<string, string>[] = [
  { "sec-purpose": "prefetch" },
  { purpose: "prefetch" },
  { "next-router-prefetch": "1" },
];

let requirePagePermission: typeof import("../lib/auth.ts").requirePagePermission;

beforeAll(async () => {
  process.env.APP_URL ??= "http://localhost:3000";
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.OIDC_ISSUER ??= "http://localhost:8080/realms/internal-tools";
  process.env.OIDC_CLIENT_ID ??= "internal-tools-web";
  process.env.OIDC_CLIENT_SECRET ??= "demo-only-change-me";
  ({ requirePagePermission } = await import("../lib/auth.ts"));
});

describe("page permission denials with prefetch headers", () => {
  it.each(prefetchHeaders)("audits a denied page request even when it carries %o", async (headers) => {
    const { user, token } = await makeUser(db, ["analyst"]);
    mocks.sessionToken = token;
    mocks.requestHeaders = headers;

    await expect(requirePagePermission("audit:read", "/audit")).rejects.toThrow("redirect:/no-access");
    const denied = await authDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.actorUserId, user.id), eq(auditLog.action, "access.denied")));
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ entityId: "/audit", metadata: { required: "permission:audit:read" } });
  });

  it.each(prefetchHeaders)("allows a permitted page request with %o without a denial row", async (headers) => {
    const { user, token } = await makeUser(db, ["admin"]);
    mocks.sessionToken = token;
    mocks.requestHeaders = headers;

    await expect(requirePagePermission("audit:read", "/audit")).resolves.toMatchObject({ id: user.id });
    const denied = await authDb
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.actorUserId, user.id), eq(auditLog.action, "access.denied")));
    expect(denied).toHaveLength(0);
  });
});
