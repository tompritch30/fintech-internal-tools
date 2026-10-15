import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@fit/core/cookie";
import { applySecurityHeaders, contentSecurityPolicy } from "./lib/security-headers.ts";

export function isPublicPath(pathname: string): boolean {
  return pathname === "/login" || pathname.startsWith("/auth/");
}

/**
 * Route gate only: no session cookie → /login. It does not check roles or validate the session;
 * pages, actions and route handlers do that on the server.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const nonce = Buffer.from(randomUUID()).toString("base64");
  const issuer = process.env.OIDC_ISSUER;
  const csp = contentSecurityPolicy(nonce, {
    dev: process.env.NODE_ENV === "development",
    idpOrigin: issuer ? new URL(issuer).origin : undefined,
  });
  if (!isPublicPath(pathname) && !request.cookies.has(SESSION_COOKIE)) {
    return applySecurityHeaders(NextResponse.redirect(new URL("/login", request.url)), csp);
  }
  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);
  return applySecurityHeaders(NextResponse.next({ request: { headers } }), csp);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
