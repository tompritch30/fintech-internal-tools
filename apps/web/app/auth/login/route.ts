import { NextResponse } from "next/server";
import { startLogin } from "@fit/core";
import { getConfig, getOidc } from "../../../lib/auth.ts";

const LOGIN_ATTEMPT_COOKIE = "fit_login";

export async function GET() {
  const config = getConfig();
  const { url, attempt } = await startLogin(await getOidc(), `${config.appUrl}/auth/callback`);
  const response = NextResponse.redirect(url);
  response.cookies.set(LOGIN_ATTEMPT_COOKIE, JSON.stringify(attempt), {
    httpOnly: true,
    sameSite: "lax",
    secure: config.appUrl.startsWith("https://"),
    path: "/auth",
    maxAge: 600,
  });
  return response;
}
