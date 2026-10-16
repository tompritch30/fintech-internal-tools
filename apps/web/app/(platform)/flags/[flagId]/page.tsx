import { randomUUID } from "node:crypto";
import { notFound } from "next/navigation";
import type { AuditListItem } from "@fit/core";
import { ActionPanel, RecordHeader, RecordSection, Timeline } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../../lib/auth.ts";
import { DecisionForms, EnvironmentForm, KillSwitchForm } from "../forms.tsx";
import { ENVIRONMENTS, flagHistory, getFlagView } from "../flags.ts";
import { describeFlagAudit, describeFlagValue, formatWhen } from "../format.ts";
import { flagActions } from "../record-actions.ts";

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
  const { actions, waiting } = flagActions(user, { prodEnabled: prod.enabled, prodVersion: prod.version, pending });

  return (
    <div className="stack">
      <RecordHeader
        back={{ href: "/flags", label: "Feature flags" }}
        title={flag.key}
        status={{ label: prod.enabled ? `Prod on · ${prod.rolloutPercentage}%` : "Prod off" }}
        owner={pending?.requestedByName ?? "None pending"}
        ownerLabel="Prod change requested by"
      />
      <ActionPanel label="Flag actions" waiting={waiting}>
        {actions.length > 0 ? (
          <div className="flex w-full flex-col gap-4">
            {pending ? <p className="text-sm text-muted-foreground">{waiting}</p> : null}
            {actions.includes("reject") && pending ? (
              <DecisionForms changeId={pending.id} version={pending.approval.version} canApprove={actions.includes("approve")} />
            ) : null}
            {actions.includes("kill") ? <KillSwitchForm flagId={flag.id} /> : null}
            {actions.includes("change")
              ? ENVIRONMENTS.filter((env) => !(env === "prod" && pending)).map((env) => (
                  <EnvironmentForm
                    key={env}
                    flagId={flag.id}
                    environment={env}
                    value={flag.values[env]}
                    version={flag.values[env].version}
                    changeId={randomUUID()}
                  />
                ))
              : null}
          </div>
        ) : null}
      </ActionPanel>
      <RecordSection
        title="Details"
        fields={[
          { label: "Description", value: flag.description },
          ...ENVIRONMENTS.map((env) => ({
            label: env,
            value: `${describeFlagValue(flag.values[env])} (updated ${formatWhen(flag.values[env].updatedAt)})`,
          })),
        ]}
      />
      <RecordSection
        title="Pending prod change"
        fields={
          pending
            ? [
                { label: "Change", value: `${describeFlagValue(pending.before)} → ${describeFlagValue(pending.after)}` },
                { label: "Requested by", value: pending.requestedByName },
                { label: "Requested", value: formatWhen(pending.requestedAt) },
                { label: "Reason", value: pending.reason },
              ]
            : [{ label: "Status", value: "None. Prod changes wait here for a different approver." }]
        }
      />
      <RecordSection title="History">
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
      </RecordSection>
    </div>
  );
}
