import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { sessions } from "@fit/db";
import { createSession, getSessionUser, hashToken, revokeSession, syncUserFromClaims } from "../src/index.ts";
import { appDb, makeUser, uniqueId } from "./helpers/db.ts";

const db = appDb();

describe("sessions", () => {
  it("returns the signed-in user and their roles for a live session", async () => {
    const { user, token } = await makeUser(db, ["analyst"]);
    const found = await getSessionUser(db, token);
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
    expect(await getSessionUser(db, "not-a-real-token")).toBeNull();
    expect(await getSessionUser(db, undefined)).toBeNull();
  });

  it("rejects an expired session", async () => {
    const { id } = await syncUserFromClaims(db, { subject: uniqueId("exp"), username: "exp", roles: [] });
    const { token } = await createSession(db, id, -1);
    expect(await getSessionUser(db, token)).toBeNull();
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
    expect(await getSessionUser(db, first.token)).not.toBeNull();
  });

  it("logout revokes the session immediately", async () => {
    const { token } = await makeUser(db, ["analyst"]);
    expect(await getSessionUser(db, token)).not.toBeNull();
    await revokeSession(db, token);
    expect(await getSessionUser(db, token)).toBeNull();
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
