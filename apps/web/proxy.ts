import { randomUUID } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { sessionCookie } from "@fit/core/cookie";
import { applySecurityHeaders, contentSecurityPolicy } from "./lib/security-headers.ts";

export function isPublicPath(pathname: string): boolean {
  // /api/flags authenticates services with its own bearer token (app/api/flags/route.ts).
  return pathname === "/login" || pathname.startsWith("/auth/") || pathname === "/api/flags";
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
  // No APP_URL here (misconfigured) falls back to the https name, the stricter of the two.
  const { name } = sessionCookie(process.env.APP_URL || "https://localhost");
  if (!isPublicPath(pathname) && !request.cookies.has(name)) {
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
