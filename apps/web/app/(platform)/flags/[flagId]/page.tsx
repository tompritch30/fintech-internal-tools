import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import type { AuditListItem } from "@fit/core";
import { CommandBar, RecordHeader, Timeline } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../../lib/auth.ts";
import { DecisionForms, EnvironmentForm, KillSwitchForm } from "../forms.tsx";
import { ENVIRONMENTS, flagHistory, getFlagView } from "../flags.ts";
import { describeFlagAudit, describeFlagValue, formatWhen } from "../format.ts";

const APPROVAL_SUMMARY: Record<string, string> = {
  "approval.requested": "prod change sent for approval",
  "approval.approved": "prod change approved",
  "approval.rejected": "prod change rejected",
  "approval.cancelled": "prod change cancelled",
};

const summary = (h: AuditListItem) => describeFlagAudit(h.after) ?? APPROVAL_SUMMARY[h.action];

export default async function FlagPage({ params }: { params: Promise<{ flagId: string }> }) {
  const { flagId } = await params;
  const user = await requirePagePermission("flags:read", `/flags/${flagId}`);
  const db = getDb();
  const flag = await getFlagView(db, flagId);
  if (!flag) notFound();
  const history = await flagHistory(db, flag.id);
  const prod = flag.values.prod;
  const pending = flag.pendingChange;
  const canChange = user.permissions.has("flags:request");
  const canDecide = pending !== null && user.permissions.has("flags:approve");

  return (
    <div className="stack">
      <RecordHeader
        title={flag.key}
        owner={null}
        status={prod.enabled ? { label: `Prod on · ${prod.rolloutPercentage}%`, tone: "success" } : { label: "Prod off", tone: "neutral" }}
        fields={[
          { label: "Description", value: flag.description },
          ...ENVIRONMENTS.map((env) => ({
            label: env,
            value: `${describeFlagValue(flag.values[env])} (updated ${formatWhen(flag.values[env].updatedAt)})`,
          })),
          {
            label: "Pending prod change",
            value: pending
              ? `${describeFlagValue(pending.before)} → ${describeFlagValue(pending.after)}, requested by ${pending.requestedByName}: ${pending.reason}`
              : "None",
          },
        ]}
      />
      {canChange ? (
        <CommandBar label="Flag actions">
          <div className="flex w-full flex-col gap-4">
            {prod.enabled ? <KillSwitchForm flagId={flag.id} /> : null}
            {ENVIRONMENTS.map((env) =>
              env === "prod" && pending ? (
                <p key={env} className="text-sm text-muted-foreground">
                  A prod change is waiting for approval. You can still turn the flag off in prod.
                </p>
              ) : (
                <EnvironmentForm
                  key={env}
                  flagId={flag.id}
                  environment={env}
                  value={flag.values[env]}
                  version={flag.values[env].version}
                  changeId={randomUUID()}
                />
              ),
            )}
          </div>
        </CommandBar>
      ) : null}
      {canDecide ? (
        <CommandBar label="Prod change decision">
          {pending.requestedBy === user.id ? (
            <p className="w-full text-sm text-muted-foreground">
              You requested this change. A different approver has to decide it; the server will refuse your approval.
            </p>
          ) : null}
          <DecisionForms changeId={pending.id} version={pending.approval.version} />
        </CommandBar>
      ) : null}
      <h2>History</h2>
      <Timeline
        items={history.map((h) => ({
          id: h.id,
          occurredAt: h.occurredAt,
          actor: h.actor,
          action: h.action,
          summary: summary(h),
          reason: h.reason,
        }))}
      />
    </div>
  );
}
