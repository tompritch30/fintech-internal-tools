import { withAudit, type ActionContext } from "@fit/core";

/** UI-kit demo only: a fixed record with no business table. A note is stored as its audit row. */
export const DEMO_RECORD = { entityType: "demo_record", entityId: "DEMO-1" } as const;

export async function addDemoNote(ctx: ActionContext, note: string): Promise<void> {
  const text = note.trim();
  if (!text) throw new Error("A note is required");
  if (text.length > 500) throw new Error("Notes are limited to 500 characters");
  await withAudit(
    ctx.db,
    { actor: { id: ctx.user.id, subject: ctx.user.subject }, action: "demo.note_added", ...DEMO_RECORD, reason: text },
    async () => undefined,
  );
}
