"use client";

import { useActionState } from "react";
import { Button, Input } from "@fit/ui";
import { claimCaseAction, decideCaseAction, openDocumentAction, revealFieldAction, signOffCaseAction } from "./actions.ts";
import { MASKED_FIELDS, type FormState } from "./format.ts";

const initial: FormState = {};
const formClass = "flex flex-wrap items-end gap-2";

function Feedback({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="w-full text-sm text-destructive">{state.error}</p>;
  if (state.message) return <p role="status" className="w-full text-sm text-muted-foreground">{state.message}</p>;
  return null;
}

export function ClaimForm({ caseId }: { caseId: string }) {
  const [state, action, pending] = useActionState(claimCaseAction, initial);
  return (
    <form action={action} className={formClass} aria-label="Claim case">
      <input type="hidden" name="caseId" value={caseId} />
      <Button type="submit" variant="primary" disabled={pending}>
        Claim case
      </Button>
      <Feedback state={state} />
    </form>
  );
}

function DecisionForm({ caseId, decision, label, noteLabel, required, variant }: {
  caseId: string;
  decision: "approve" | "reject" | "escalate";
  label: string;
  noteLabel: string;
  required: boolean;
  variant: "primary" | "danger" | "default";
}) {
  const [state, action, pending] = useActionState(decideCaseAction, initial);
  return (
    <form action={action} className={formClass} aria-label={label}>
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="decision" value={decision} />
      <Input id={`${decision}-note`} name="note" label={noteLabel} required={required} maxLength={1000} className="w-80" />
      <Button type="submit" variant={variant} disabled={pending}>
        {label}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function DecisionForms({ caseId, highRisk }: { caseId: string; highRisk: boolean }) {
  return (
    <div className="flex w-full flex-col gap-3">
      <DecisionForm
        caseId={caseId}
        decision="approve"
        label={highRisk ? "Approve (needs sign-off)" : "Approve"}
        noteLabel="Approval note (optional)"
        required={false}
        variant="primary"
      />
      <DecisionForm caseId={caseId} decision="reject" label="Reject" noteLabel="Rejection reason" required variant="danger" />
      <DecisionForm caseId={caseId} decision="escalate" label="Escalate" noteLabel="Escalation note" required variant="default" />
    </div>
  );
}

function SignOffForm({ caseId, version, decision }: { caseId: string; version: number; decision: "approve" | "reject" }) {
  const [state, action, pending] = useActionState(signOffCaseAction, initial);
  const approve = decision === "approve";
  return (
    <form action={action} className={formClass} aria-label={approve ? "Sign off approval" : "Refuse sign-off"}>
      <input type="hidden" name="caseId" value={caseId} />
      <input type="hidden" name="decision" value={decision} />
      <input type="hidden" name="expectedVersion" value={version} />
      <Input
        id={`signoff-${decision}-note`}
        name="note"
        label={approve ? "Sign-off note (optional)" : "Reason for refusing"}
        required={!approve}
        maxLength={1000}
        className="w-80"
      />
      <Button type="submit" variant={approve ? "primary" : "danger"} disabled={pending}>
        {approve ? "Sign off approval" : "Refuse sign-off"}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function SignOffForms({ caseId, version }: { caseId: string; version: number }) {
  return (
    <div className="flex w-full flex-col gap-3">
      <SignOffForm caseId={caseId} version={version} decision="approve" />
      <SignOffForm caseId={caseId} version={version} decision="reject" />
    </div>
  );
}

export function RevealForm({ caseId }: { caseId: string }) {
  const [state, action, pending] = useActionState(revealFieldAction, initial);
  return (
    <form action={action} className={formClass} aria-label="Reveal a masked field">
      <input type="hidden" name="caseId" value={caseId} />
      <label className="flex flex-col gap-1 text-sm">
        Field
        <select name="field" className="h-9 rounded-md border border-input bg-background px-2" defaultValue="idNumber">
          {Object.entries(MASKED_FIELDS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <Input id="reveal-reason" name="reason" label="Reason for revealing" required minLength={10} maxLength={500} className="w-72" />
      <Button type="submit" disabled={pending}>
        Reveal
      </Button>
      {state.revealed !== undefined ? (
        <p role="status" className="w-full text-sm">
          Value: <strong data-testid="revealed-value">{state.revealed}</strong> (this read is audited)
        </p>
      ) : null}
      <Feedback state={state} />
    </form>
  );
}

export function OpenDocumentForm({ documentId, fileName }: { documentId: string; fileName: string }) {
  const [state, action, pending] = useActionState(openDocumentAction, initial);
  return (
    <form action={action} className={formClass} aria-label={`Open ${fileName}`}>
      <input type="hidden" name="documentId" value={documentId} />
      <Input id={`open-${documentId}-reason`} name="reason" label={`Reason for opening ${fileName}`} required minLength={10} maxLength={500} className="w-72" />
      <Button type="submit" disabled={pending}>
        Open {fileName}
      </Button>
      {state.revealed !== undefined ? (
        <pre data-testid={`document-${documentId}`} className="w-full whitespace-pre-wrap rounded-md border p-3 text-sm">
          {state.revealed}
        </pre>
      ) : null}
      <Feedback state={state} />
    </form>
  );
}
