import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { appDb, expectDbError, ownerDb, uniqueId } from "./helpers/db.ts";

const app = appDb();
const owner = ownerDb();

async function insertRow(entityId: string) {
  await app.execute(sql`insert into audit_log (action, entity_type, entity_id) values ('test.row', 'test', ${entityId})`);
}

describe("audit_log is append-only at the database level", () => {
  it("lets the app role INSERT and SELECT (positive control)", async () => {
    const id = uniqueId("ins");
    await insertRow(id);
    const result = await app.execute(sql`select count(*)::int as n from audit_log where entity_id = ${id}`);
    expect(result.rows[0]).toEqual({ n: 1 });
  });

  it("rejects UPDATE by the app role", async () => {
    const id = uniqueId("upd");
    await insertRow(id);
    await expectDbError(app.execute(sql`update audit_log set action = 'tampered' where entity_id = ${id}`), /permission denied/);
  });

  it("rejects DELETE by the app role", async () => {
    const id = uniqueId("del");
    await insertRow(id);
    await expectDbError(app.execute(sql`delete from audit_log where entity_id = ${id}`), /permission denied/);
  });

  it("rejects TRUNCATE by the app role", async () => {
    await expectDbError(app.execute(sql`truncate audit_log`), /permission denied/);
  });

  it("rejects UPDATE, DELETE and TRUNCATE by the owner role via the trigger", async () => {
    const id = uniqueId("own");
    await insertRow(id);
    await expectDbError(owner.execute(sql`update audit_log set action = 'tampered' where entity_id = ${id}`), /append-only/);
    await expectDbError(owner.execute(sql`delete from audit_log where entity_id = ${id}`), /append-only/);
    await expectDbError(owner.execute(sql`truncate audit_log`), /append-only/);
    const result = await app.execute(sql`select action from audit_log where entity_id = ${id}`);
    expect(result.rows).toEqual([{ action: "test.row" }]);
  });
});
