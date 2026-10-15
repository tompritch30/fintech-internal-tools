import Link from "next/link";
import { notFound } from "next/navigation";
import type { AuditListItem } from "@fit/core";
import { Badge, CommandBar, RecordHeader, Timeline } from "@fit/ui";
import { getDb, requirePagePermission } from "../../../../../lib/auth.ts";
import { ClaimForm, DecisionForms, OpenDocumentForm, RevealForm, SignOffForms } from "../../forms.tsx";
import { MASKED_FIELDS, RISK, STATUS, formatDay, formatWhen } from "../../format.ts";
import { caseHistory, getKycCase } from "../../kyc.ts";

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

export default async function KycCasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const { caseId } = await params;
  const user = await requirePagePermission("kyc:read", `/kyc/cases/${caseId}`);
  const db = getDb();
  const kase = await getKycCase({ db, user }, caseId);
  if (!kase) notFound();
  const history = await caseHistory(db, kase.id);
  const status = STATUS[kase.status] ?? { label: kase.status, tone: "neutral" as const };
  const can = (p: "kyc:request" | "kyc:approve" | "pii:unmask") => user.permissions.has(p);
  const canClaim = can("kyc:request") && (kase.status === "open" || kase.status === "escalated");
  const canDecide = can("kyc:request") && kase.status === "in_review" && kase.ownerId === user.id;
  const signOff = kase.status === "pending_approval" && kase.approval?.status === "pending" ? kase.approval : null;
  const canSignOff = can("kyc:approve") && signOff !== null;
  const canUnmask = can("pii:unmask");

  return (
    <div className="stack">
      <p className="text-sm">
        <Link className="underline underline-offset-4" href="/kyc">
          ← KYC queue
        </Link>
      </p>
      <RecordHeader
        title={`${kase.reference} · ${kase.applicantName}`}
        status={status}
        owner={kase.ownerName}
        fields={[
          {
            label: "Risk",
            value: (
              <span className="flex flex-wrap gap-1">
                <Badge tone={kase.highRisk ? "danger" : "neutral"}>{RISK[kase.riskRating] ?? kase.riskRating}</Badge>
                {kase.sanctionsHit ? <Badge tone="danger">Sanctions hit</Badge> : null}
                {kase.pep ? <Badge tone="warning">PEP</Badge> : null}
              </span>
            ),
          },
          { label: "Date of birth", value: kase.dateOfBirth },
          { label: "ID number", value: kase.idNumber },
          { label: "Address", value: kase.address },
          { label: "Nationality", value: kase.nationality },
          { label: "Opened", value: formatWhen(kase.openedAt) },
          { label: "Decision note", value: kase.decisionNote ?? "—" },
          { label: "Retained until", value: kase.retentionUntil ? formatDay(kase.retentionUntil) : "Not closed" },
        ]}
      />
      {canClaim || canDecide || canSignOff ? (
        <CommandBar label="Case actions">
          {canClaim ? <ClaimForm caseId={kase.id} /> : null}
          {canDecide ? (
            <>
              {kase.highRisk ? (
                <p className="w-full text-sm text-muted-foreground">
                  High-risk case: approving sends it to a different approver for four-eyes sign-off.
                </p>
              ) : null}
              <DecisionForms caseId={kase.id} highRisk={kase.highRisk} />
            </>
          ) : null}
          {canSignOff && signOff ? (
            <>
              <p className="w-full text-sm text-muted-foreground">
                {signOff.requestedBy === user.id
                  ? "You asked for this sign-off. A different approver has to give it; the server will refuse yours."
                  : `${signOff.requestedByName} approved this high-risk case and needs your sign-off.`}
              </p>
              <SignOffForms caseId={kase.id} version={signOff.version} />
            </>
          ) : null}
        </CommandBar>
      ) : kase.status === "in_review" ? (
        <p>Claimed by {kase.ownerName ?? "another analyst"}. Only they can decide it.</p>
      ) : kase.status === "pending_approval" ? (
        <p>Waiting for a different approver to sign off.</p>
      ) : null}
      <h2>Documents</h2>
      <ul className="stack">
        {kase.documents.map((d) => (
          <li key={d.id} className="stack">
            <span>
              {d.fileName} <span className="text-sm text-muted-foreground">({d.kind.replace("_", " ")})</span>
            </span>
            {canUnmask ? <OpenDocumentForm documentId={d.id} fileName={d.fileName} /> : null}
          </li>
        ))}
      </ul>
      {canUnmask ? (
        <>
          <h2>Reveal applicant details</h2>
          <p className="text-sm text-muted-foreground">Masked: {Object.values(MASKED_FIELDS).join(", ")}. Each reveal needs a reason and is audited.</p>
          <RevealForm caseId={kase.id} />
        </>
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
