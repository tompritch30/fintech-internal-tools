import { NextResponse, type NextRequest } from "next/server";
import {
  completeLogin,
  createSession,
  SESSION_COOKIE,
  syncUserFromClaims,
  withAudit,
  type IdentityClaims,
  type LoginAttempt,
} from "@fit/core";
import type { Tx } from "@fit/db";
import { getConfig, getDb, getOidc, sessionCookieOptions } from "../../../lib/auth.ts";

const LOGIN_ATTEMPT_COOKIE = "fit_login";

export async function GET(request: NextRequest) {
  const config = getConfig();
  const fail = () => {
    const response = NextResponse.redirect(`${config.appUrl}/login?error=login_failed`);
    response.cookies.delete({ name: LOGIN_ATTEMPT_COOKIE, path: "/auth" });
    return response;
  };

  const raw = request.cookies.get(LOGIN_ATTEMPT_COOKIE)?.value;
  if (!raw) return fail();

  let claims: IdentityClaims;
  try {
    const attempt = JSON.parse(raw) as LoginAttempt;
    // Rebuild the callback URL on the public origin: the request URL may carry the container's host.
    const callbackUrl = new URL(request.nextUrl.pathname + request.nextUrl.search, config.appUrl);
    claims = await completeLogin(await getOidc(), callbackUrl, attempt, config.oidc.rolesClaim);
  } catch (err) {
    console.error("OIDC callback failed", err instanceof Error ? err.message : err);
    return fail();
  }

  const session = await withAudit(
    getDb(),
    (r) => ({
      actor: { id: r.userId, subject: claims.subject },
      action: "auth.login",
      entityType: "user",
      entityId: r.userId,
      metadata: { roles: r.roles },
    }),
    async (tx: Tx) => {
      const user = await syncUserFromClaims(tx, claims);
      const created = await createSession(tx, user.id, config.sessionTtlHours, claims.idToken);
      return { ...created, userId: user.id, roles: user.roles };
    },
  );

  const response = NextResponse.redirect(`${config.appUrl}/`);
  response.cookies.set(SESSION_COOKIE, session.token, sessionCookieOptions(session.expiresAt));
  response.cookies.delete({ name: LOGIN_ATTEMPT_COOKIE, path: "/auth" });
  return response;
}
