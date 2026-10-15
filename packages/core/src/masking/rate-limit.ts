export const DEFAULT_UNMASK_RATE_LIMIT_PER_HOUR = 20;

function invalidLimit(): never {
  throw new Error("UNMASK_RATE_LIMIT_PER_HOUR must be a positive integer (see .env.example)");
}

export function unmaskRateLimit(env: NodeJS.ProcessEnv = process.env): { max: number; windowMinutes: 60 } {
  const value = env.UNMASK_RATE_LIMIT_PER_HOUR;
  if (value === undefined || value === "") {
    return { max: DEFAULT_UNMASK_RATE_LIMIT_PER_HOUR, windowMinutes: 60 };
  }
  if (!/^[1-9]\d*$/.test(value)) invalidLimit();

  const max = Number(value);
  if (!Number.isSafeInteger(max)) invalidLimit();
  return { max, windowMinutes: 60 };
}
