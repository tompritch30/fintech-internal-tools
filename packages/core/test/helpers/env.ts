// Server tests run against real Postgres (AGENTS.md). Defaults match docker compose.
export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? "postgres://app_runtime:demo-only-change-me@localhost:5432/internal_tools_test";
export const TEST_DATABASE_OWNER_URL =
  process.env.TEST_DATABASE_OWNER_URL ?? "postgres://app_owner:demo-only-change-me@localhost:5432/internal_tools_test";
