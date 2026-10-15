import { listAuditForEntity } from "@fit/core";
import { ActionDialog, ActionPanel, Input, RecordHeader, RecordSection, Timeline } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../lib/auth.ts";
import { addDemoNoteAction } from "./actions.ts";
import { DEMO_RECORD } from "./note.ts";

/** Reference for the shared record layout: header, one action panel, then titled sections. */
export default async function DemoRecordPage() {
  const user = await requirePagePermission("platform:access", "/demo-record");
  const history = await listAuditForEntity(getDb(), DEMO_RECORD.entityType, DEMO_RECORD.entityId);
  return (
    <div className="stack">
      <RecordHeader title={`${DEMO_RECORD.entityId} · Sample record`} status={{ label: "In review" }} owner={user.displayName ?? user.username} />
      <ActionPanel label="Record actions" waiting="No actions available.">
        <ActionDialog label="Add note" variant="primary" action={addDemoNoteAction}>
          <Input id="note" name="note" label="Note" required maxLength={500} />
        </ActionDialog>
      </ActionPanel>
      <RecordSection
        title="Details"
        fields={[
          { label: "Type", value: "UI kit demo" },
          { label: "Entries", value: history.length },
        ]}
      />
      <RecordSection title="History">
        <Timeline
          items={history.map((h) => ({
            id: h.id,
            occurredAt: h.occurredAt,
            actor: h.actor,
            action: h.action,
            reason: h.reason,
          }))}
        />
      </RecordSection>
    </div>
  );
}
