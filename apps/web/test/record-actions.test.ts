import { describe, expect, it } from "vitest";
import { permissionsFor } from "@fit/core";
import { flagActions } from "../app/(platform)/flags/record-actions.ts";
import { caseActions } from "../app/(platform)/kyc/record-actions.ts";
import { paymentActions, refundActions } from "../app/(platform)/refunds/record-actions.ts";

const viewer = (id: string, roles: string[]) => ({ id, permissions: permissionsFor(roles) as ReadonlySet<string> });
const analyst = viewer("u-analyst", ["analyst"]);
const approver = viewer("u-approver", ["approver"]);
const senior = viewer("u-senior", ["analyst", "approver"]);
const admin = viewer("u-admin", ["admin"]);

const pendingRefund = (requestedBy: string) => ({ status: "pending_approval", requestedBy, approval: { status: "pending" } });

describe("refund record: only actions the user can take, otherwise a waiting line", () => {
  it("offers approve and reject to an approver who did not request the refund", () => {
    expect(refundActions(approver, pendingRefund(analyst.id)).actions).toEqual(["approve", "reject"]);
  });

  it("offers no decision to the requester, even with approver rights, and says who it waits for", () => {
    const r = refundActions(senior, pendingRefund(senior.id));
    expect(r.actions).toEqual([]);
    expect(r.waiting).toBe("You requested this refund. Waiting for a different approver.");
  });

  it("offers no decision to a user without approver rights", () => {
    const r = refundActions(analyst, pendingRefund(senior.id));
    expect(r.actions).toEqual([]);
    expect(r.waiting).toMatch(/^Waiting for an approver/);
  });

  it("offers nothing once the refund is decided", () => {
    for (const status of ["succeeded", "rejected", "cancelled"]) {
      expect(refundActions(approver, { status, requestedBy: analyst.id, approval: { status: "approved" } }).actions).toEqual([]);
    }
  });

  it("offers a refund request to an analyst while money is left, and not to an approver-only user", () => {
    expect(paymentActions(analyst, { availablePence: 100, pendingPence: 0 }).actions).toEqual(["request"]);
    expect(paymentActions(approver, { availablePence: 100, pendingPence: 0 }).actions).toEqual([]);
    expect(paymentActions(analyst, { availablePence: 0, pendingPence: 0 })).toEqual({ actions: [], waiting: "Fully refunded. Nothing left to refund." });
  });
});

describe("KYC case record: only actions the user can take, otherwise a waiting line", () => {
  const base = { ownerId: null, ownerName: null, approval: null };

  it("offers claim on open and escalated cases to analysts only", () => {
    for (const status of ["open", "escalated"]) {
      expect(caseActions(analyst, { ...base, status }).actions).toEqual(["claim"]);
      expect(caseActions(approver, { ...base, status })).toEqual({ actions: [], waiting: "Waiting for an analyst to claim this case." });
    }
  });

  it("offers decisions only to the analyst who claimed the case", () => {
    const kase = { ...base, status: "in_review", ownerId: analyst.id, ownerName: "analyst" };
    expect(caseActions(analyst, kase).actions).toEqual(["approve", "reject", "escalate"]);
    expect(caseActions(senior, kase)).toEqual({ actions: [], waiting: "Claimed by analyst. Only they can decide it." });
  });

  it("offers sign-off to a different approver, never to the one who asked", () => {
    const kase = { ...base, status: "pending_approval", approval: { status: "pending", requestedBy: senior.id } };
    expect(caseActions(approver, kase).actions).toEqual(["signOff", "refuseSignOff"]);
    expect(caseActions(senior, kase)).toEqual({ actions: [], waiting: "You asked for this sign-off. Waiting for a different approver." });
    expect(caseActions(analyst, kase)).toEqual({ actions: [], waiting: "Waiting for a different approver to sign off." });
  });

  it("offers nothing on closed cases, or to an admin", () => {
    expect(caseActions(approver, { ...base, status: "approved" }).actions).toEqual([]);
    expect(caseActions(analyst, { ...base, status: "rejected" }).actions).toEqual([]);
    expect(caseActions(admin, { ...base, status: "open" }).actions).toEqual([]);
  });
});

describe("feature flag record: only actions the user can take, otherwise a waiting line", () => {
  const pendingBy = (id: string) => ({ prodEnabled: false, pending: { requestedBy: id } });

  it("offers approve and reject on a pending prod change to an approver who did not request it", () => {
    expect(flagActions(approver, pendingBy(analyst.id)).actions).toEqual(["approve", "reject"]);
    expect(flagActions(senior, pendingBy(analyst.id)).actions).toEqual(["change", "approve", "reject"]);
  });

  it("offers no decision to the requester, even with approver rights, and says who it waits for", () => {
    const r = flagActions(senior, pendingBy(senior.id));
    expect(r.actions).toEqual(["change"]);
    expect(r.waiting).toBe("You requested this prod change. Waiting for a different approver.");
  });

  it("offers changes to analysts, the kill switch only while prod is on, and no decision without a pending change", () => {
    expect(flagActions(analyst, { prodEnabled: false, pending: null }).actions).toEqual(["change"]);
    expect(flagActions(analyst, { prodEnabled: true, pending: null }).actions).toEqual(["change", "kill"]);
    expect(flagActions(approver, { prodEnabled: true, pending: null }).actions).toEqual([]);
    expect(flagActions(analyst, pendingBy(senior.id)).actions).toEqual(["change"]);
  });
});
