/**
 * Session cookie name and Secure flag. Its own module so the Next.js proxy can import it without the DB client.
 * Like Auth.js's secure-cookie prefix: `__Host-` (which requires Secure) unless the app is on local http
 * (loopback only), where some browsers reject `__Host-` cookies. Remote http keeps Secure, so the token
 * never travels in clear text; login there fails closed.
 */
const LOOPBACK = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function sessionCookie(appUrl: string): { name: string; secure: boolean } {
  const url = new URL(appUrl);
  const secure = !(url.protocol === "http:" && LOOPBACK.has(url.hostname));
  return { name: secure ? "__Host-fit_session" : "fit_session", secure };
}
