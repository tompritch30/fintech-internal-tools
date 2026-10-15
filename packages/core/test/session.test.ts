import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sessions } from "@fit/db";
import { createSession, getSessionUser, hashToken, revokeSession, syncUserFromClaims } from "../src/index.ts";
import { appDb, makeUser, uniqueId } from "./helpers/db.ts";

const db = appDb();

describe("sessions", () => {
  it("returns the signed-in user and their roles for a live session", async () => {
    const { user, token } = await makeUser(db, ["analyst"]);
    const found = await getSessionUser(db, token, 15);
    expect(found?.id).toBe(user.id);
    expect(found?.roles).toEqual(["analyst"]);
  });

  it("stores only a hash of the session token", async () => {
    const { token } = await makeUser(db, ["analyst"]);
    const rows = await db.select().from(sessions).where(eq(sessions.id, token));
    expect(rows).toHaveLength(0);
    const hashed = await db.select().from(sessions).where(eq(sessions.id, hashToken(token)));
    expect(hashed).toHaveLength(1);
  });

  it("rejects an unknown token", async () => {
    expect(await getSessionUser(db, "not-a-real-token", 15)).toBeNull();
    expect(await getSessionUser(db, undefined, 15)).toBeNull();
  });

  it("rejects an expired session", async () => {
    const { id } = await syncUserFromClaims(db, { subject: uniqueId("exp"), username: "exp", roles: [] });
    const { token } = await createSession(db, id, -1);
    expect(await getSessionUser(db, token, 15)).toBeNull();
  });

  it("deletes the user's expired sessions when they sign in again", async () => {
    const { id } = await syncUserFromClaims(db, { subject: uniqueId("gc"), username: "gc", roles: [] });
    await createSession(db, id, -1, "old-id-token");
    const { token } = await createSession(db, id, 8);
    const rows = await db.select().from(sessions).where(eq(sessions.userId, id));
    expect(rows.map((r) => r.id)).toEqual([hashToken(token)]);
  });

  it("keeps the user's other live sessions when they sign in again", async () => {
    const { id } = await syncUserFromClaims(db, { subject: uniqueId("gc2"), username: "gc2", roles: [] });
    const first = await createSession(db, id, 8);
    await createSession(db, id, 8);
    expect(await getSessionUser(db, first.token, 15)).not.toBeNull();
  });

  it("logout revokes the session immediately", async () => {
    const { token } = await makeUser(db, ["analyst"]);
    expect(await getSessionUser(db, token, 15)).not.toBeNull();
    await revokeSession(db, token);
    expect(await getSessionUser(db, token, 15)).toBeNull();
  });

  it("rejects a session idle for longer than the idle timeout", async () => {
    const { token } = await makeUser(db, ["analyst"]);
    await db.update(sessions).set({ lastSeenAt: sql`now() - interval '16 minutes'` })
      .where(eq(sessions.id, hashToken(token)));

    expect(await getSessionUser(db, token, 15)).toBeNull();
  });

  it("keeps a session last used 14 minutes ago and refreshes last_seen_at", async () => {
    const { token } = await makeUser(db, ["analyst"]);
    await db.update(sessions).set({ lastSeenAt: sql`now() - interval '14 minutes'` })
      .where(eq(sessions.id, hashToken(token)));
    const [before] = await db.select({ lastSeenAt: sessions.lastSeenAt }).from(sessions)
      .where(eq(sessions.id, hashToken(token)));

    expect(await getSessionUser(db, token, 15)).not.toBeNull();

    const [after] = await db.select({ lastSeenAt: sessions.lastSeenAt }).from(sessions)
      .where(eq(sessions.id, hashToken(token)));
    expect(after?.lastSeenAt.getTime()).toBeGreaterThan(before!.lastSeenAt.getTime() + 13 * 60_000);
  });

  it("replaces roles with the IdP's roles at login and ignores unknown roles", async () => {
    const subject = uniqueId("sync");
    const first = await syncUserFromClaims(db, { subject, username: "sync", roles: ["admin", "offline_access"] });
    expect(first.roles).toEqual(["admin"]);
    const second = await syncUserFromClaims(db, { subject, username: "sync", roles: ["analyst"] });
    expect(second.id).toBe(first.id);
    expect(second.roles).toEqual(["analyst"]);
  });
});
