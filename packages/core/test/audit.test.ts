import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, users } from "@fit/db";
import { listAudit, listAuditForEntity, withAudit } from "../src/index.ts";
import { appDb, makeUser, uniqueId } from "./helpers/db.ts";

const db = appDb();

// A real change for withAudit to wrap: renaming a user's display name.
const rename = (id: string, name: string) => async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => {
  await tx.update(users).set({ displayName: name }).where(eq(users.id, id));
  return name;
};

async function auditRowsFor(entityId: string) {
  return db.select().from(auditLog).where(eq(auditLog.entityId, entityId));
}
async function displayName(id: string) {
  const [row] = await db.select({ n: users.displayName }).from(users).where(eq(users.id, id));
  return row?.n;
}

describe("withAudit", () => {
  it("writes the change and its audit row together", async () => {
    const { user } = await makeUser(db, ["admin"]);
    await withAudit(
      db,
      (name) => ({
        actor: { id: user.id, subject: user.subject },
        action: "user.renamed",
        entityType: "user",
        entityId: user.id,
        after: { displayName: name },
      }),
      rename(user.id, "Renamed"),
    );
    expect(await displayName(user.id)).toBe("Renamed");
    const rows = await auditRowsFor(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "user.renamed", actorUserId: user.id, after: { displayName: "Renamed" } });
  });

  it("rolls back the audit row when the change fails", async () => {
    const { user } = await makeUser(db, ["admin"]);
    const entityId = uniqueId("fail-change");
    await expect(
      withAudit(db, { actor: { id: user.id, subject: user.subject }, action: "x", entityType: "test", entityId }, async (tx) => {
        await tx.update(users).set({ displayName: "Should roll back" }).where(eq(users.id, user.id));
        throw new Error("business rule failed");
      }),
    ).rejects.toThrow("business rule failed");
    expect(await displayName(user.id)).toBeNull();
    expect(await auditRowsFor(entityId)).toHaveLength(0);
  });

  it("rolls back the change when the audit insert fails", async () => {
    const { user } = await makeUser(db, ["admin"]);
    await expect(
      withAudit(
        db,
        // actorUserId must reference a real user, so this audit insert fails.
        { actor: { id: "00000000-0000-4000-8000-000000000000", subject: null }, action: "x", entityType: "user", entityId: user.id },
        rename(user.id, "Should roll back"),
      ),
    ).rejects.toThrow();
    expect(await displayName(user.id)).toBeNull();
    expect(await auditRowsFor(user.id)).toHaveLength(0);
  });

  it("rolls back with the outer transaction when nested in one", async () => {
    const { user } = await makeUser(db, ["admin"]);
    await expect(
      db.transaction(async (tx) => {
        await withAudit(tx, { actor: { id: user.id, subject: user.subject }, action: "user.renamed", entityType: "user", entityId: user.id }, rename(user.id, "Nested"));
        await tx.execute(sql`select 1/0`);
      }),
    ).rejects.toThrow();
    expect(await displayName(user.id)).toBeNull();
    expect(await auditRowsFor(user.id)).toHaveLength(0);
  });
});

describe("audit queries order by time", () => {
  // IDs come from a sequence, times from clock_timestamp(); concurrent writers can get them in opposite orders.
  async function rowsOutOfIdOrder() {
    const entityId = uniqueId("order");
    const later = new Date("2030-01-01T12:00:02Z");
    const earlier = new Date("2030-01-01T12:00:01Z");
    await db.insert(auditLog).values({ action: "order.later", entityType: "order_test", entityId, occurredAt: later });
    await db.insert(auditLog).values({ action: "order.earlier", entityType: "order_test", entityId, occurredAt: earlier });
    return entityId;
  }

  it("lists audit rows newest first by occurredAt, not by insertion order", async () => {
    const entityId = await rowsOutOfIdOrder();
    const desc = await listAudit(db, { search: entityId });
    expect(desc.rows.map((r) => r.action)).toEqual(["order.later", "order.earlier"]);
    const asc = await listAudit(db, { search: entityId, dir: "asc" });
    expect(asc.rows.map((r) => r.action)).toEqual(["order.earlier", "order.later"]);
  });

  it("returns a record's history newest first by occurredAt", async () => {
    const entityId = await rowsOutOfIdOrder();
    const rows = await listAuditForEntity(db, "order_test", entityId);
    expect(rows.map((r) => r.action)).toEqual(["order.later", "order.earlier"]);
  });
});
