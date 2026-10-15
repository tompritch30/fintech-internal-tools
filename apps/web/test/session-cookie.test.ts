import { NextRequest } from "next/server";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { SESSION_COOKIE } from "@fit/core/cookie";
import { appDb, makeUser } from "../../../packages/core/test/helpers/db.ts";
import { TEST_DATABASE_URL } from "../../../packages/core/test/helpers/env.ts";

const mocks = vi.hoisted(() => ({ db: null as unknown }));

vi.mock("server-only", () => ({}));

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}));

vi.mock("next/navigation", () => ({
  redirect: (destination: string): never => {
    throw new Error(`redirect:${destination}`);
  },
}));

vi.mock("../lib/auth.ts", async (importOriginal) => {
  const auth = await importOriginal<typeof import("../lib/auth.ts")>();
  return {
    ...auth,
    getDb: () => mocks.db as never,
    getOidc: async () => {
      throw new Error("OIDC is not needed by the logout-cookie test");
    },
  };
});

const db = appDb();
mocks.db = db;

let sessionCookieOptions: typeof import("../lib/auth.ts").sessionCookieOptions;
let logout: typeof import("../app/auth/logout/route.ts").POST;

beforeAll(async () => {
  process.env.APP_URL = "http://localhost:3000";
  process.env.DATABASE_URL = TEST_DATABASE_URL;
  process.env.OIDC_ISSUER = "http://localhost:8080/realms/internal-tools";
  process.env.OIDC_CLIENT_ID = "internal-tools-web";
  process.env.OIDC_CLIENT_SECRET = "demo-only-change-me";
  process.env.OIDC_ROLES_CLAIM ??= "roles";
  ({ sessionCookieOptions } = await import("../lib/auth.ts"));
  ({ POST: logout } = await import("../app/auth/logout/route.ts"));
});

describe("session cookie hardening", () => {
  it("uses a secure __Host- cookie with root path and no domain on localhost", () => {
    expect(SESSION_COOKIE).toBe("__Host-fit_session");
    const options = sessionCookieOptions(new Date(Date.now() + 60_000));
    expect(options).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    expect(options).not.toHaveProperty("domain");
  });

  it("expires the session cookie on same-origin logout and rejects a cross-origin POST", async () => {
    const { token } = await makeUser(db, ["analyst"]);
    const cookie = `${SESSION_COOKIE}=${token}`;
    const crossOrigin = await logout(
      new NextRequest("http://localhost:3000/auth/logout", {
        method: "POST",
        headers: { origin: "https://evil.example", cookie },
      }),
    );
    expect(crossOrigin.status).toBe(403);

    const response = await logout(
      new NextRequest("http://localhost:3000/auth/logout", {
        method: "POST",
        headers: { origin: "http://localhost:3000", cookie },
      }),
    );
    expect(response.status).toBe(303);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^__Host-fit_session=/);
    expect(setCookie).toMatch(/;\s*Path=\//i);
    expect(setCookie).toMatch(/;\s*Secure(?:;|$)/i);
    expect(setCookie).not.toMatch(/;\s*Domain=/i);
    expect(setCookie).toMatch(/Expires=Thu, 01 Jan 1970 00:00:00 GMT/i);
  });
});
