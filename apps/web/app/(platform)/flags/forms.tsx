"use client";

import { useActionState } from "react";
import { Button, Input, inputClass } from "@fit/ui";
import type { FlagEnvironment } from "@fit/db";
import { approveFlagChangeAction, changeFlagAction, killFlagAction, rejectFlagChangeAction } from "./actions.ts";
import type { FlagValue } from "./flags.ts";
import type { FormState } from "./format.ts";

const initial: FormState = {};
const formClass = "flex flex-wrap items-end gap-2";

function Feedback({ state }: { state: FormState }) {
  if (state.error) return <p role="alert" className="w-full text-sm text-destructive">{state.error}</p>;
  if (state.message) return <p role="status" className="w-full text-sm text-muted-foreground">{state.message}</p>;
  return null;
}

/**
 * One environment's value. `changeId` is minted when the page renders, so a double-submitted prod
 * request reuses it and creates one change. The server decides whether the change applies at
 * once, is a kill switch, or needs approval.
 */
export function EnvironmentForm({
  flagId,
  environment,
  value,
  version,
  changeId,
}: {
  flagId: string;
  environment: FlagEnvironment;
  value: FlagValue;
  version: number;
  changeId: string;
}) {
  const [state, action, pending] = useActionState(changeFlagAction, initial);
  const prod = environment === "prod";
  return (
    <form action={action} className={formClass} aria-label={prod ? "Request a prod change" : `Change ${environment}`}>
      <input type="hidden" name="flagId" value={flagId} />
      <input type="hidden" name="environment" value={environment} />
      <input type="hidden" name="expectedVersion" value={version} />
      <input type="hidden" name="changeId" value={changeId} />
      <div className="grid gap-1.5">
        <label htmlFor={`${environment}-enabled`} className="text-sm font-medium leading-none">
          {environment} state
        </label>
        <select id={`${environment}-enabled`} name="enabled" defaultValue={value.enabled ? "on" : "off"} className={`${inputClass} w-24`}>
          <option value="on">On</option>
          <option value="off">Off</option>
        </select>
      </div>
      <Input
        id={`${environment}-rollout`}
        name="rollout"
        label="Rollout %"
        inputMode="numeric"
        required
        defaultValue={String(value.rolloutPercentage)}
        className="w-24"
      />
      <Input id={`${environment}-reason`} name="reason" label="Reason" required maxLength={500} className="w-64" />
      <Button type="submit" variant={prod ? "primary" : "default"} disabled={pending}>
        {prod ? "Request prod change" : `Save ${environment}`}
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function KillSwitchForm({ flagId }: { flagId: string }) {
  const [state, action, pending] = useActionState(killFlagAction, initial);
  return (
    <form action={action} className={formClass} aria-label="Prod kill switch">
      <input type="hidden" name="flagId" value={flagId} />
      <Input id="kill-reason" name="reason" label="Why turn it off?" required maxLength={500} className="w-64" />
      <Button type="submit" variant="danger" disabled={pending}>
        Turn off in prod now
      </Button>
      <Feedback state={state} />
    </form>
  );
}

export function DecisionForms({ changeId, version, canApprove = true }: { changeId: string; version: number; canApprove?: boolean }) {
  const [approved, approve, approving] = useActionState(approveFlagChangeAction, initial);
  const [rejected, reject, rejecting] = useActionState(rejectFlagChangeAction, initial);
  const pending = approving || rejecting;
  return (
    <div className="flex w-full flex-col gap-3">
      {canApprove ? (
        <form action={approve} className={formClass} aria-label="Approve prod change">
          <input type="hidden" name="changeId" value={changeId} />
          <input type="hidden" name="expectedVersion" value={version} />
          <Input id="approve-note" name="note" label="Approval note (optional)" maxLength={500} className="w-64" />
          <Button type="submit" variant="primary" disabled={pending}>
            Approve prod change
          </Button>
          <Feedback state={approved} />
        </form>
      ) : null}
      <form action={reject} className={formClass} aria-label="Reject prod change">
        <input type="hidden" name="changeId" value={changeId} />
        <input type="hidden" name="expectedVersion" value={version} />
        <Input id="reject-note" name="note" label="Rejection reason" required maxLength={500} className="w-64" />
        <Button type="submit" variant="danger" disabled={pending}>
          Reject
        </Button>
        <Feedback state={rejected} />
      </form>
    </div>
  );
}
