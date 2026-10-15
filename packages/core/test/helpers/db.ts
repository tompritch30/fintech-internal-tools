import { randomUUID } from "node:crypto";
import { afterAll } from "vitest";
import { createDb, type Db } from "@fit/db";
import { createSession, getSessionUser, syncUserFromClaims, type SessionUser } from "../../src/index.ts";
import { TEST_DATABASE_OWNER_URL, TEST_DATABASE_URL } from "./env.ts";

/** Connects as app_runtime, the role the app uses at runtime. */
export function appDb(): Db {
  const db = createDb(TEST_DATABASE_URL, { max: 2 });
  afterAll(() => db.$client.end());
  return db;
}

/** Connects as app_owner (migrations role). */
export function ownerDb(): Db {
  const db = createDb(TEST_DATABASE_OWNER_URL, { max: 1 });
  afterAll(() => db.$client.end());
  return db;
}

/** Creates a fresh user with the given roles and a live session. audit_log can't be cleaned, so ids are unique. */
export async function makeUser(db: Db, roles: string[]): Promise<{ user: SessionUser; token: string }> {
  const subject = `test-${randomUUID()}`;
  const { id } = await syncUserFromClaims(db, { subject, username: subject, roles });
  const { token } = await createSession(db, id, 1);
  const user = await getSessionUser(db, token);
  if (!user) throw new Error("test user has no session");
  return { user, token };
}

export const uniqueId = (prefix: string) => `${prefix}-${randomUUID()}`;

/** Drizzle wraps driver errors ("Failed query: ..."); the Postgres message is on `cause`. */
export async function expectDbError(promise: Promise<unknown>, pattern: RegExp): Promise<void> {
  const err = await promise.then(
    () => null,
    (e: unknown) => e,
  );
  if (!(err instanceof Error)) throw new Error(`expected a database error matching ${pattern}, but the query succeeded`);
  const message = err.cause instanceof Error ? err.cause.message : err.message;
  if (!pattern.test(message)) throw new Error(`expected database error matching ${pattern}, got: ${message}`);
}
