import { notFound } from "next/navigation";
import { MIN_UNMASK_REASON_LENGTH, type AuditListItem } from "@fit/core";
import { ActionButton, ActionDialog, ActionPanel, Input, RecordHeader, RecordSection, RevealButton, StatusBadge, Timeline } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../../../lib/auth.ts";
import { claimCaseAction, decideCaseAction, openDocumentAction, revealFieldAction, signOffCaseAction } from "../../actions.ts";
import { MASKED_FIELDS, formatDay, formatWhen, riskBadges, statusOf } from "../../format.ts";
import { caseHistory, getKycCase, type KycMaskedField } from "../../kyc.ts";
import { caseActions } from "../../record-actions.ts";

function summary(h: AuditListItem): string | undefined {
  const after = (h.after ?? {}) as { status?: string };
  const meta = h as AuditListItem & { entityType: string };
  switch (h.action) {
    case "kyc.claimed":
      return "claimed the case";
    case "kyc.approval_requested":
      return "approved; high-risk, so sent for four-eyes sign-off";
    case "kyc.approved":
      return "case approved and closed";
    case "kyc.rejected":
      return "case rejected and closed";
    case "kyc.escalated":
      return "escalated and released to the queue";
    case "kyc.signoff_rejected":
      return "sign-off refused; back with the analyst";
    case "approval.requested":
      return "sign-off requested";
    case "approval.approved":
      return "sign-off given";
    case "approval.rejected":
      return "sign-off refused";
    case "field.unmask":
      return meta.entityType === "kyc_document" ? "opened a document" : "revealed a masked field";
    default:
      return after.status;
  }
}

const SIGN_OFF_STATUS: Record<string, string> = { pending: "Waiting for sign-off", approved: "Signed off", rejected: "Refused", cancelled: "Cancelled" };

export default async function KycCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const user = await requirePagePermission("kyc:read", `/kyc/cases/${caseId}`);
  const db = getDb();
  const kase = await getKycCase({ db, user }, caseId);
  if (!kase) notFound();
  const history = await caseHistory(db, kase.id);
  const { actions, waiting } = caseActions(user, kase);
  const canUnmask = user.permissions.has("pii:unmask");
  const masked = (field: KycMaskedField) =>
    canUnmask ? (
      <RevealButton
        what={MASKED_FIELDS[field]}
        masked={kase[field]}
        action={revealFieldAction}
        hidden={{ caseId: kase.id, field }}
        minReasonLength={MIN_UNMASK_REASON_LENGTH}
      />
    ) : (
      kase[field]
    );
  const decide = (decision: "approve" | "reject" | "escalate") => ({ caseId: kase.id, decision });
  const signOff = (decision: "approve" | "reject") => ({ caseId: kase.id, decision, expectedVersion: kase.approval?.version ?? 0 });

  return (
    <div className="stack">
      <RecordHeader back={{ href: "/kyc", label: "KYC queue" }} title={`${kase.reference} · ${kase.applicantName}`} status={statusOf(kase.status)} owner={kase.ownerName} />
      <ActionPanel
        label="Case actions"
        waiting={waiting}
        note={
          actions.includes("approve") && kase.highRisk
            ? "High-risk case: approving sends it to a different approver for four-eyes sign-off."
            : actions.includes("signOff") && kase.approval
              ? `${kase.approval.requestedByName} approved this high-risk case and needs your sign-off.`
              : undefined
        }
      >
        {actions.includes("claim") ? <ActionButton label="Claim case" variant="primary" action={claimCaseAction} hidden={{ caseId: kase.id }} /> : null}
        {actions.includes("approve") ? (
          <ActionDialog label={kase.highRisk ? "Approve (needs sign-off)" : "Approve"} variant="primary" action={decideCaseAction} hidden={decide("approve")}>
            <Input id="approve-note" name="note" label="Approval note (optional)" maxLength={1000} />
          </ActionDialog>
        ) : null}
        {actions.includes("reject") ? (
          <ActionDialog label="Reject" variant="danger" action={decideCaseAction} hidden={decide("reject")}>
            <Input id="reject-note" name="note" label="Rejection reason" required maxLength={1000} />
          </ActionDialog>
        ) : null}
        {actions.includes("escalate") ? (
          <ActionDialog label="Escalate" description="The case goes back to the queue for another analyst." action={decideCaseAction} hidden={decide("escalate")}>
            <Input id="escalate-note" name="note" label="Escalation note" required maxLength={1000} />
          </ActionDialog>
        ) : null}
        {actions.includes("signOff") ? (
          <ActionDialog label="Sign off approval" variant="primary" action={signOffCaseAction} hidden={signOff("approve")}>
            <Input id="signoff-approve-note" name="note" label="Sign-off note (optional)" maxLength={1000} />
          </ActionDialog>
        ) : null}
        {actions.includes("refuseSignOff") ? (
          <ActionDialog label="Refuse sign-off" variant="danger" description="The case goes back to its analyst." action={signOffCaseAction} hidden={signOff("reject")}>
            <Input id="signoff-reject-note" name="note" label="Reason for refusing" required maxLength={1000} />
          </ActionDialog>
        ) : null}
      </ActionPanel>
      <RecordSection
        title="Details"
        fields={[
          { label: "Applicant", value: masked("applicantName") },
          {
            label: "Risk",
            value: (
              <span className="flex flex-wrap gap-1">
                {riskBadges(kase).map((b) => (
                  <StatusBadge key={b.label} {...b} />
                ))}
              </span>
            ),
          },
          { label: "Date of birth", value: masked("dateOfBirth") },
          { label: "ID number", value: masked("idNumber") },
          { label: "Address", value: masked("address") },
          { label: "Nationality", value: kase.nationality },
          { label: "Opened", value: formatWhen(kase.openedAt) },
          { label: "Claimed", value: kase.claimedAt ? formatWhen(kase.claimedAt) : "—" },
        ]}
      />
      <RecordSection title="Documents">
        <ul aria-label="Documents" className="divide-y rounded-lg border bg-card shadow-xs">
          {kase.documents.map((d) => (
            <li key={d.id} className="flex flex-col gap-2 px-4 py-3">
              <span className="text-sm">
                <span className="font-medium">{d.fileName}</span> <span className="text-muted-foreground">({d.kind.replace("_", " ")})</span>
              </span>
              {canUnmask ? (
                <RevealButton what={d.fileName} action={openDocumentAction} hidden={{ documentId: d.id }} minReasonLength={MIN_UNMASK_REASON_LENGTH} display="block" />
              ) : null}
            </li>
          ))}
        </ul>
      </RecordSection>
      <RecordSection
        title="Decision"
        fields={[
          { label: "Decision note", value: kase.decisionNote ?? "—" },
          { label: "Sign-off", value: kase.approval ? (SIGN_OFF_STATUS[kase.approval.status] ?? kase.approval.status) : kase.highRisk ? "Needed on approval" : "Not needed" },
          { label: "Signed off by", value: kase.approval?.decidedByName ?? "—" },
          { label: "Closed", value: kase.closedAt ? formatWhen(kase.closedAt) : "Not closed" },
          { label: "Retained until", value: kase.retentionUntil ? formatDay(kase.retentionUntil) : "Not closed" },
        ]}
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
