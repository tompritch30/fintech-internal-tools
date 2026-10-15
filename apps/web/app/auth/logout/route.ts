import { NextResponse, type NextRequest } from "next/server";
import { buildLogoutUrl, getSessionUser, revokeSession, SESSION_COOKIE, withAudit } from "@fit/core";
import { getConfig, getDb, getOidc } from "../../../lib/auth.ts";
import { isSameOrigin } from "../../../lib/same-origin.ts";

/** POST only, from our own origin, so a link, prefetch or another site's form can't sign someone out. */
export async function POST(request: NextRequest) {
  const config = getConfig();
  if (!isSameOrigin(request.headers, config.appUrl)) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  const db = getDb();
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  let idToken: string | null = null;

  if (token) {
    const user = await getSessionUser(db, token);
    if (user) {
      const revoked = await withAudit(
        db,
        { actor: { id: user.id, subject: user.subject }, action: "auth.logout", entityType: "user", entityId: user.id },
        (tx) => revokeSession(tx, token),
      );
      idToken = revoked?.idToken ?? null;
    }
  }

  let target = `${config.appUrl}/login`;
  try {
    target = buildLogoutUrl(await getOidc(), `${config.appUrl}/login`, idToken)?.href ?? target;
  } catch (err) {
    console.error("IdP logout URL unavailable", err instanceof Error ? err.message : err);
  }
  const response = NextResponse.redirect(target, 303);
  response.cookies.delete(SESSION_COOKIE);
  return response;
}
