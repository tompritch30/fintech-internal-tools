/** True for Next.js router prefetches and browser speculative prefetches. */
export function isPrefetchRequest(headers: Headers): boolean {
  return (
    headers.has("next-router-prefetch") ||
    headers.get("purpose") === "prefetch" ||
    (headers.get("sec-purpose")?.includes("prefetch") ?? false)
  );
}
