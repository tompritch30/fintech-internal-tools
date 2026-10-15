export const DEFAULT_UNMASK_RATE_LIMIT_PER_HOUR = 20;

export function unmaskRateLimit(_env: NodeJS.ProcessEnv = process.env): { max: number; windowMinutes: 60 } {
  return { max: DEFAULT_UNMASK_RATE_LIMIT_PER_HOUR, windowMinutes: 60 };
}

export const UNMASK_RATE_LIMIT = { max: DEFAULT_UNMASK_RATE_LIMIT_PER_HOUR, windowMinutes: 60 } as const;
