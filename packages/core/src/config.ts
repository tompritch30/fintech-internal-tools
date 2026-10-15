import { unmaskRateLimit } from "./masking/rate-limit.ts";

export interface OidcConfig {
  issuer: string;
  /** Server-to-server base for the issuer (Docker only). See ARCHITECTURE.md §3.3. */
  internalIssuer?: string;
  clientId: string;
  clientSecret: string;
  rolesClaim: string;
  allowInsecureHttp: boolean;
}

export interface CoreConfig {
  appUrl: string;
  databaseUrl: string;
  sessionTtlHours: number;
  sessionIdleMinutes: number;
  unmaskRateLimitPerHour: number;
  oidc: OidcConfig;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name];
  if (!value) throw new Error(`${name} is not set (see .env.example)`);
  return value;
}

function positiveInteger(env: NodeJS.ProcessEnv, name: string, defaultValue: number): number {
  const value = env[name];
  if (value === undefined || value === "") return defaultValue;
  if (!/^[1-9]\d*$/.test(value) || !Number.isSafeInteger(Number(value))) {
    throw new Error(`${name} must be a positive integer (see .env.example)`);
  }
  return Number(value);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CoreConfig {
  return {
    appUrl: required(env, "APP_URL").replace(/\/$/, ""),
    databaseUrl: required(env, "DATABASE_URL"),
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? "8"),
    sessionIdleMinutes: positiveInteger(env, "SESSION_IDLE_MINUTES", 15),
    unmaskRateLimitPerHour: unmaskRateLimit(env).max,
    oidc: {
      issuer: required(env, "OIDC_ISSUER"),
      internalIssuer: env.OIDC_INTERNAL_ISSUER || undefined,
      clientId: required(env, "OIDC_CLIENT_ID"),
      clientSecret: required(env, "OIDC_CLIENT_SECRET"),
      rolesClaim: env.OIDC_ROLES_CLAIM ?? "roles",
      allowInsecureHttp: env.OIDC_ALLOW_INSECURE_HTTP === "true",
    },
  };
}
