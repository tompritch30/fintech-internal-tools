import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog } from "@fit/db";
import { appDb, makeUser } from "../../../packages/core/test/helpers/db.ts";
import { addDemoNote, DEMO_RECORD } from "../app/(platform)/demo-record/note.ts";

const db = appDb();

const notesBy = (userId: string) =>
  db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.actorUserId, userId), eq(auditLog.entityId, DEMO_RECORD.entityId)));

describe("demo record: add note", () => {
  it("writes a demo.note_added audit row with the note as the reason", async () => {
    const { user } = await makeUser(db, ["analyst"]);
    await addDemoNote({ db, user }, "  Called the customer back  ");
    const rows = await notesBy(user.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "demo.note_added", entityType: "demo_record", reason: "Called the customer back" });
  });

  it("rejects an empty note and writes no audit row", async () => {
    const { user } = await makeUser(db, ["analyst"]);
    await expect(addDemoNote({ db, user }, "   ")).rejects.toThrow("A note is required");
    expect(await notesBy(user.id)).toHaveLength(0);
  });
});
