import { describe, expect, it } from "vitest";
import { DEFAULT_UNMASK_RATE_LIMIT_PER_HOUR, unmaskRateLimit } from "../src/index.ts";
import { loadConfig } from "../src/config.ts";

const baseEnv: NodeJS.ProcessEnv = {
  APP_URL: "http://localhost:3000",
  DATABASE_URL: "postgres://app_runtime:test@localhost:5432/internal_tools",
  OIDC_ISSUER: "http://localhost:8080/realms/internal-tools",
  OIDC_CLIENT_ID: "internal-tools-web",
  OIDC_CLIENT_SECRET: "test",
};

describe("configuration", () => {
  it("defaults session idle and unmask limits", () => {
    const config = loadConfig(baseEnv);
    expect(config.sessionIdleMinutes).toBe(15);
    expect(config.unmaskRateLimitPerHour).toBe(20);
    expect(DEFAULT_UNMASK_RATE_LIMIT_PER_HOUR).toBe(20);
    expect(unmaskRateLimit({ UNMASK_RATE_LIMIT_PER_HOUR: "" })).toEqual({ max: 20, windowMinutes: 60 });
  });

  it("reads configured session idle and unmask limits", () => {
    const config = loadConfig({ ...baseEnv, SESSION_IDLE_MINUTES: "30", UNMASK_RATE_LIMIT_PER_HOUR: "5" });
    expect(config.sessionIdleMinutes).toBe(30);
    expect(config.unmaskRateLimitPerHour).toBe(5);
  });

  it.each(["0", "-1", "abc", "1.5"])("rejects invalid SESSION_IDLE_MINUTES value %j", (value) => {
    expect(() => loadConfig({ ...baseEnv, SESSION_IDLE_MINUTES: value }))
      .toThrow("SESSION_IDLE_MINUTES must be a positive integer (see .env.example)");
  });

  it.each(["0", "-1", "abc", "1.5"])("rejects invalid UNMASK_RATE_LIMIT_PER_HOUR value %j", (value) => {
    expect(() => loadConfig({ ...baseEnv, UNMASK_RATE_LIMIT_PER_HOUR: value }))
      .toThrow("UNMASK_RATE_LIMIT_PER_HOUR must be a positive integer (see .env.example)");
  });
});
