import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { AuditListItem } from "@fit/core";
import { createDb, users } from "@fit/db";
import { makeUser, ownerDb } from "../../../packages/core/test/helpers/db.ts";
import { TEST_DATABASE_URL } from "../../../packages/core/test/helpers/env.ts";
import { withActorNames } from "../lib/actor-names.ts";

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.$client.end());
const owner = ownerDb();

const item = (id: number, actor: string | null): AuditListItem => ({ id, occurredAt: new Date(), actor, action: "test.action", entityType: "test", entityId: "x", reason: null, after: null });

describe("record histories show display names", () => {
  it("swaps each actor's username for their display name and keeps the username", async () => {
    const named = (await makeUser(db, ["analyst"])).user;
    await owner.update(users).set({ displayName: "Sam Senior" }).where(eq(users.id, named.id));
    const plain = (await makeUser(db, ["analyst"])).user;
    const rows = await withActorNames(db, [item(1, named.username), item(2, plain.username), item(3, null)]);
    expect(rows.map((r) => [r.actor, r.actorName])).toEqual([
      [named.username, "Sam Senior"],
      [plain.username, plain.username],
      [null, null],
    ]);
  });

  it("does nothing for an empty history", async () => {
    expect(await withActorNames(db, [])).toEqual([]);
  });
});
