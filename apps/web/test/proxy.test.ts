import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sessionCookie } from "@fit/core/cookie";
import { proxy } from "../proxy.ts";
import { isPrefetchRequest } from "../lib/prefetch.ts";

const SESSION_COOKIE = sessionCookie(process.env.APP_URL ?? "http://localhost:3000").name;

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, "http://localhost:3000"), { headers });

describe("proxy reads the session cookie name for the APP_URL scheme", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("on local http, lets through the plain fit_session cookie and not the __Host- one", () => {
    vi.stubEnv("APP_URL", "http://localhost:3000");
    expect(proxy(request("/audit", { cookie: "fit_session=abc" })).status).toBe(200);
    expect(proxy(request("/audit", { cookie: "__Host-fit_session=abc" })).status).toBe(307);
  });

  it("on https, lets through only the __Host- cookie", () => {
    vi.stubEnv("APP_URL", "https://tools.example.test");
    expect(proxy(request("/audit", { cookie: "__Host-fit_session=abc" })).status).toBe(200);
    expect(proxy(request("/audit", { cookie: "fit_session=abc" })).status).toBe(307);
  });
});

describe("proxy route gating", () => {
  it("redirects an unauthenticated request for a protected page to /login", () => {
    const res = proxy(request("/audit"));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe("http://localhost:3000/login");
  });

  it("lets a request with a session cookie through (positive control)", () => {
    const res = proxy(request("/audit", { cookie: `${SESSION_COOKIE}=abc` }));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("x-middleware-next")).toBe("1");
  });

  it("lets services reach the flags endpoint without a session; the route checks its own token", () => {
    expect(proxy(request("/api/flags?environment=prod")).headers.get("location")).toBeNull();
    // control: everything else is still gated
    for (const path of ["/api/flagsx", "/api/other", "/flags"]) {
      expect(proxy(request(path)).headers.get("location"), path).toBe("http://localhost:3000/login");
    }
  });

  it("does not gate the login page or auth routes", () => {
    for (const path of ["/login", "/auth/login", "/auth/callback?code=x"]) {
      expect(proxy(request(path)).headers.get("location")).toBeNull();
    }
  });
});

describe("proxy security headers", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("forwards a unique nonce and CSP with the request", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OIDC_ISSUER", "https://idp.example/realms/internal-tools");

    const first = proxy(request("/audit", { cookie: `${SESSION_COOKIE}=abc` }));
    const second = proxy(request("/audit", { cookie: `${SESSION_COOKIE}=abc` }));
    const csp = first.headers.get("content-security-policy")!;
    const nonce = csp.match(/'nonce-([^']+)'/)?.[1];

    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("script-src 'self' 'nonce-");
    expect(csp).toContain("'strict-dynamic'");
    expect(csp).toContain("style-src 'self' 'unsafe-inline'");
    expect(csp).toContain("img-src 'self' data: blob:");
    expect(csp).toContain("font-src 'self'");
    expect(csp).toContain("connect-src 'self'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("form-action 'self' https://idp.example");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(nonce).toBeTruthy();
    expect(first.headers.get("x-middleware-request-x-nonce")).toBe(nonce);
    expect(first.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    expect(second.headers.get("x-middleware-request-x-nonce")).not.toBe(nonce);
  });

  it("sets required response headers on pass-through and login redirect responses", () => {
    const passThrough = proxy(request("/audit", { cookie: `${SESSION_COOKIE}=abc` }));
    const redirect = proxy(request("/audit"));

    for (const response of [passThrough, redirect]) {
      expect(response.headers.get("strict-transport-security")).toBe("max-age=63072000; includeSubDomains");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
      expect(response.headers.get("permissions-policy")).toBe("camera=(), microphone=(), geolocation=()");
      expect(response.headers.get("content-security-policy")).toBeTruthy();
    }
    expect(redirect.status).toBe(307);
    expect(redirect.headers.get("location")).toContain("/login");
  });

  it("allows unsafe-eval only in development", () => {
    vi.stubEnv("NODE_ENV", "development");
    const response = proxy(request("/audit", { cookie: `${SESSION_COOKIE}=abc` }));
    expect(response.headers.get("content-security-policy")).toContain("'unsafe-eval'");
  });
});

describe("isPrefetchRequest", () => {
  it("detects Next.js and browser prefetch headers", () => {
    expect(isPrefetchRequest(new Headers({ "next-router-prefetch": "1" }))).toBe(true);
    expect(isPrefetchRequest(new Headers({ purpose: "prefetch" }))).toBe(true);
    expect(isPrefetchRequest(new Headers({ "sec-purpose": "prefetch;prerender" }))).toBe(true);
  });

  it("treats a normal navigation as not a prefetch (positive control)", () => {
    expect(isPrefetchRequest(new Headers({ accept: "text/html" }))).toBe(false);
  });
});
