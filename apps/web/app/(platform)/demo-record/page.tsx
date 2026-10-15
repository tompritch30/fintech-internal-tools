import { listAuditForEntity } from "@fit/core";
import { Button, CommandBar, Input, RecordHeader, Timeline } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../lib/auth.ts";
import { addDemoNoteAction } from "./actions.ts";
import { DEMO_RECORD } from "./note.ts";

export default async function DemoRecordPage() {
  const user = await requirePagePermission("platform:access", "/demo-record");
  const history = await listAuditForEntity(getDb(), DEMO_RECORD.entityType, DEMO_RECORD.entityId);
  return (
    <div className="stack">
      <RecordHeader
        title={`${DEMO_RECORD.entityId} · Sample record`}
        status={{ label: "In review", tone: "warning" }}
        owner={user.displayName ?? user.username}
        fields={[
          { label: "Type", value: "UI kit demo" },
          { label: "Entries", value: history.length },
        ]}
      />
      <CommandBar label="Record actions">
        <form action={addDemoNoteAction} style={{ display: "flex", gap: 8, alignItems: "end" }}>
          <Input id="note" name="note" label="Note" required maxLength={500} />
          <Button type="submit" variant="primary">
            Add note
          </Button>
        </form>
      </CommandBar>
      <h2>History</h2>
      <Timeline
        items={history.map((h) => ({
          id: h.id,
          occurredAt: h.occurredAt,
          actor: h.actor,
          action: h.action,
          reason: h.reason,
        }))}
      />
    </div>
  );
}
