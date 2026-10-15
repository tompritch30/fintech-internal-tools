/** True when the request's Origin is the app's own origin. Browsers send Origin on every POST. */
export function isSameOrigin(headers: Headers, appUrl: string): boolean {
  const origin = headers.get("origin");
  return origin !== null && origin === new URL(appUrl).origin;
}
