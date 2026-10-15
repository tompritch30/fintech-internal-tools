import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@fit/core/cookie";

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
  if (!isPublicPath(pathname) && !request.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }
  const headers = new Headers(request.headers);
  headers.set("x-pathname", pathname);
  return NextResponse.next({ request: { headers } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
