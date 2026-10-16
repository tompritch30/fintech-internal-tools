/**
 * Session cookie name and Secure flag. Its own module so the Next.js proxy can import it without the DB client.
 * Like Auth.js's secure-cookie prefix: `__Host-` (which requires Secure) only when the app is served over https;
 * a plain name on local http, where some browsers reject `__Host-` cookies.
 */
export function sessionCookie(appUrl: string): { name: string; secure: boolean } {
  const secure = new URL(appUrl).protocol === "https:";
  return { name: secure ? "__Host-fit_session" : "fit_session", secure };
}
