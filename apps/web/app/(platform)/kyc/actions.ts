"use server";

import { revalidatePath } from "next/cache";
import { ConflictError, ForbiddenError, NotFoundError, SelfApprovalError, ValidationError } from "@fit/core";
import { defineAction } from "../../../lib/auth.ts";
import { revealFailure } from "../../../lib/reveal-errors.ts";
import type { FormState } from "./format.ts";
import { claimCase, decideCase, openCaseDocument, revealCaseField, signOffCase, type KycDecision, type KycMaskedField } from "./kyc.ts";

const field = (form: FormData, name: string) => String(form.get(name) ?? "");

/** Expected errors become form messages; anything else is a bug and goes to the error boundary. */
function failure(err: unknown): FormState {
  if (err instanceof SelfApprovalError) return { error: "You asked for this sign-off, so a different approver must give it." };
  if (err instanceof ForbiddenError) {
    return { error: err.required === "kyc:case-owner" ? "Only the analyst who claimed this case can act on it." : "You don't have permission to do that." };
  }
  if (err instanceof ConflictError) return { error: `${err.message}. Reload the page.` };
  if (err instanceof ValidationError || err instanceof NotFoundError) return { error: err.message };
  throw err;
}

export const claimCaseAction = defineAction("kyc:request", "kyc.claim", async (ctx, _prev: FormState, form: FormData): Promise<FormState> => {
  const caseId = field(form, "caseId");
  try {
    await claimCase(ctx, { caseId });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/kyc/cases/${caseId}`);
  return { message: "Claimed. You own this case now." };
});

const DONE: Record<KycDecision, string> = {
  approve: "Decision recorded.",
  reject: "Rejected. The case is closed.",
  escalate: "Escalated. The case is back in the queue for another analyst.",
};

export const decideCaseAction = defineAction("kyc:request", "kyc.decide", async (ctx, _prev: FormState, form: FormData): Promise<FormState> => {
  const caseId = field(form, "caseId");
  const decision = field(form, "decision") as KycDecision;
  try {
    const view = await decideCase(ctx, { caseId, decision, note: field(form, "note") });
    revalidatePath(`/kyc/cases/${caseId}`);
    if (view.status === "pending_approval") return { message: "High-risk case: sent for four-eyes sign-off by a different approver." };
    if (view.status === "approved") return { message: "Approved. The case is closed." };
    return { message: DONE[decision] };
  } catch (err) {
    return failure(err);
  }
});

export const signOffCaseAction = defineAction("kyc:approve", "kyc.signOff", async (ctx, _prev: FormState, form: FormData): Promise<FormState> => {
  const caseId = field(form, "caseId");
  const decision = field(form, "decision") === "approve" ? "approve" : "reject";
  try {
    await signOffCase(ctx, { caseId, decision, note: field(form, "note"), expectedVersion: Number(field(form, "expectedVersion")) });
  } catch (err) {
    return failure(err);
  }
  revalidatePath(`/kyc/cases/${caseId}`);
  return { message: decision === "approve" ? "Signed off. The case is approved and closed." : "Sign-off refused. The case is back with its analyst." };
});

export const revealFieldAction = defineAction("pii:unmask", "kyc.reveal", async (ctx, _prev: FormState, form: FormData): Promise<FormState> => {
  const caseId = field(form, "caseId");
  try {
    const value = await revealCaseField(ctx, {
      caseId,
      field: field(form, "field") as KycMaskedField,
      reason: field(form, "reason"),
    });
    revalidatePath(`/kyc/cases/${caseId}`);
    return { revealed: value ?? "" };
  } catch (err) {
    return revealFailure(err);
  }
});

export const openDocumentAction = defineAction("pii:unmask", "kyc.openDocument", async (ctx, _prev: FormState, form: FormData): Promise<FormState> => {
  try {
    const doc = await openCaseDocument(ctx, { documentId: field(form, "documentId"), reason: field(form, "reason") });
    revalidatePath(`/kyc/cases/${doc.caseId}`);
    return { revealed: doc.content };
  } catch (err) {
    return revealFailure(err);
  }
});
