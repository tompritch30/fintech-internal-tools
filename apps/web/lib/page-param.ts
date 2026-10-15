/** Highest page a list will request; keeps `(page - 1) * pageSize` a safe database offset. */
export const MAX_PAGE = 1_000_000_000;

/** Parses a `?page=` value: a whole number from 1 to MAX_PAGE, else page 1. */
export function parsePageParam(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(Math.floor(n), MAX_PAGE);
}
