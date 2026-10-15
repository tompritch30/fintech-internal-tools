import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE } from "@fit/core/cookie";
import { proxy } from "../proxy.ts";
import { isPrefetchRequest } from "../lib/prefetch.ts";

const request = (path: string, headers: Record<string, string> = {}) =>
  new NextRequest(new URL(path, "http://localhost:3000"), { headers });

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
