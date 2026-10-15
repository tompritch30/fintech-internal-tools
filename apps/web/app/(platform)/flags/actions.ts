"use server";

import { revalidatePath } from "next/cache";
import { ConflictError, ForbiddenError, NotFoundError, SelfApprovalError, ValidationError } from "@fit/core";
import type { FlagEnvironment } from "@fit/db";
import { defineAction } from "../../../lib/auth.ts";
import { approveFlagChange, changeFlag, killFlag, parseRolloutPercentage, rejectFlagChange } from "./flags.ts";
import type { FormState } from "./format.ts";

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** Expected errors become form messages; anything else is a bug and goes to the error boundary. */
function failure(err: unknown): FormState {
  if (err instanceof SelfApprovalError) return { error: "You requested this change, so a different approver must decide it." };
  if (err instanceof ForbiddenError) return { error: "You don't have permission to do that." };
  if (err instanceof ConflictError || err instanceof ValidationError || err instanceof NotFoundError) return { error: err.message };
  throw err;
}

const OUTCOME = {
  applied: "Saved. The new value is live.",
  killed: "Turned off in prod. Services see it on their next read.",
  pending_approval: "Sent for approval. Prod is unchanged until a different approver approves it.",
} as const;

export const changeFlagAction = defineAction(
  "flags:request",
  "flags.change",
  async (ctx, _prev: FormState, form: FormData): Promise<FormState> => {
    const flagId = field(form, "flagId");
    try {
      const { outcome } = await changeFlag(ctx, {
        flagId,
        environment: field(form, "environment") as FlagEnvironment,
        enabled: field(form, "enabled") === "on",
        rolloutPercentage: parseRolloutPercentage(field(form, "rollout")),
        reason: field(form, "reason"),
        expectedVersion: Number(field(form, "expectedVersion")),
        changeId: field(form, "changeId"),
      });
      revalidatePath(`/flags/${flagId}`);
      return { message: OUTCOME[outcome] };
    } catch (err) {
      return failure(err);
    }
  },
);

export const killFlagAction = defineAction(
  "flags:request",
  "flags.kill",
  async (ctx, _prev: FormState, form: FormData): Promise<FormState> => {
    const flagId = field(form, "flagId");
    try {
      await killFlag(ctx, { flagId, reason: field(form, "reason") });
      revalidatePath(`/flags/${flagId}`);
      return { message: OUTCOME.killed };
    } catch (err) {
      return failure(err);
    }
  },
);

export const approveFlagChangeAction = defineAction(
  "flags:approve",
  "flags.approve",
  async (ctx, _prev: FormState, form: FormData): Promise<FormState> => {
    try {
      const change = await approveFlagChange(ctx, {
        changeId: field(form, "changeId"),
        expectedVersion: Number(field(form, "expectedVersion")),
        note: field(form, "note"),
      });
      revalidatePath(`/flags/${change.flagId}`);
      return { message: "Approved. The prod value is live." };
    } catch (err) {
      return failure(err);
    }
  },
);

export const rejectFlagChangeAction = defineAction(
  "flags:approve",
  "flags.reject",
  async (ctx, _prev: FormState, form: FormData): Promise<FormState> => {
    try {
      const change = await rejectFlagChange(ctx, {
        changeId: field(form, "changeId"),
        expectedVersion: Number(field(form, "expectedVersion")),
        note: field(form, "note"),
      });
      revalidatePath(`/flags/${change.flagId}`);
      return { message: "Rejected. Prod is unchanged." };
    } catch (err) {
      return failure(err);
    }
  },
);
