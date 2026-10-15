export const MAX_PAGE = 10_000;

export function parsePageParam(raw: string | undefined): number {
  return Math.max(1, Number(raw) || 1);
}
