import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { AuditListItem } from "@fit/core";
import { auditLog, createDb, users } from "@fit/db";
import { makeUser, ownerDb } from "../../../packages/core/test/helpers/db.ts";
import { TEST_DATABASE_URL } from "../../../packages/core/test/helpers/env.ts";
import { withActorNames } from "../lib/actor-names.ts";

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.$client.end());
const owner = ownerDb();

const item = (id: number, actor: string | null): AuditListItem => ({ id, occurredAt: new Date(), actor, action: "test.action", entityType: "test", entityId: "x", reason: null, after: null });

async function auditRowsBy(userIds: string[]): Promise<number[]> {
  const rows = await owner
    .insert(auditLog)
    .values(userIds.map((actorUserId) => ({ actorUserId, action: "test.action", entityType: "test", entityId: "x" })))
    .returning({ id: auditLog.id });
  return rows.map((r) => r.id);
}

describe("record histories show display names", () => {
  it("swaps each actor's username for their display name and keeps the username", async () => {
    const named = (await makeUser(db, ["analyst"])).user;
    await owner.update(users).set({ displayName: "Sam Senior" }).where(eq(users.id, named.id));
    const plain = (await makeUser(db, ["analyst"])).user;
    const [namedRow, plainRow] = await auditRowsBy([named.id, plain.id]);
    const rows = await withActorNames(db, [item(namedRow!, named.username), item(plainRow!, plain.username), item(-1, null)]);
    expect(rows.map((r) => [r.actor, r.actorName])).toEqual([
      [named.username, "Sam Senior"],
      [plain.username, plain.username],
      [null, null],
    ]);
  });

  it("names each row by the user who wrote it, even when two users share a username", async () => {
    const first = (await makeUser(db, ["analyst"])).user;
    const second = (await makeUser(db, ["analyst"])).user;
    await owner.update(users).set({ displayName: "Alex First" }).where(eq(users.id, first.id));
    await owner.update(users).set({ username: first.username, displayName: "Alex Second" }).where(eq(users.id, second.id));
    const ids = await auditRowsBy([first.id, second.id]);
    const rows = await withActorNames(db, ids.map((id) => item(id, first.username)));
    expect(rows.map((r) => r.actorName)).toEqual(["Alex First", "Alex Second"]);
  });

  it("does nothing for an empty history", async () => {
    expect(await withActorNames(db, [])).toEqual([]);
  });
});
