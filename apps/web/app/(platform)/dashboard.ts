import "server-only";
import { and, count, desc, eq, inArray, ne, notLike, sql } from "drizzle-orm";
import type { SessionUser } from "@fit/core";
import { approvalRequests, auditLog, flagChanges, flagValues, flags, kycCases, payments, refunds, users, type Db } from "@fit/db";
import { flagChangeApproval } from "./flags/flags.ts";
import { describeFlagValue } from "./flags/format.ts";
import { kycApproval } from "./kyc/kyc.ts";
import { refundApproval } from "./refunds/refunds.ts";

type Viewer = Pick<SessionUser, "id" | "permissions">;

export interface AwaitingItem {
  id: string;
  kind: "Refund" | "KYC sign-off" | "Flag change";
  title: string;
  href: string;
  /** Display name, falling back to the username. */
  requestedByName: string;
  requestedByUsername: string;
  requestedAt: Date;
}

export interface ActivityItem {
  id: number;
  occurredAt: Date;
  action: string;
  record: string;
  href: string | null;
}

const LIMIT = 8;
const requesterName = sql<string>`coalesce(${users.displayName}, ${users.username})`;

/**
 * Pending approvals this user could decide: kinds they hold the approve permission for,
 * excluding ones they requested (the four-eyes rule would refuse those anyway).
 */
export async function awaitingMyApproval(db: Db, user: Viewer, opts: { limit?: number } = {}): Promise<{ items: AwaitingItem[]; total: number; byKind: { refunds: number; kyc: number; flags: number } }> {
  const limit = opts.limit ?? LIMIT;
  const pendingFromOthers = (kind: string) =>
    and(eq(approvalRequests.kind, kind), eq(approvalRequests.status, "pending"), ne(approvalRequests.requestedBy, user.id));
  const items: AwaitingItem[] = [];
  const byKind = { refunds: 0, kyc: 0, flags: 0 };
  if (user.permissions.has(refundApproval.approvePermission)) {
    const where = pendingFromOthers(refundApproval.kind);
    const rows = await db
      .select({ id: refunds.id, reference: payments.reference, amountPence: refunds.amountPence, requestedByName: requesterName, requestedByUsername: users.username, requestedAt: approvalRequests.requestedAt })
      .from(refunds)
      .innerJoin(approvalRequests, eq(approvalRequests.id, refunds.approvalRequestId))
      .innerJoin(payments, eq(payments.id, refunds.paymentId))
      .innerJoin(users, eq(users.id, approvalRequests.requestedBy))
      .where(where)
      .orderBy(approvalRequests.requestedAt)
      .limit(limit);
    const [n] = await db.select({ n: count() }).from(approvalRequests).where(where);
    byKind.refunds = n?.n ?? 0;
    for (const r of rows) {
      items.push({
        id: r.id,
        kind: "Refund",
        title: `${r.reference} · ${new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(r.amountPence / 100)}`,
        href: `/refunds/requests/${r.id}`,
        requestedByName: r.requestedByName,
        requestedByUsername: r.requestedByUsername,
        requestedAt: r.requestedAt,
      });
    }
  }
  if (user.permissions.has(kycApproval.approvePermission)) {
    const where = pendingFromOthers(kycApproval.kind);
    const rows = await db
      .select({ id: kycCases.id, reference: kycCases.reference, requestedByName: requesterName, requestedByUsername: users.username, requestedAt: approvalRequests.requestedAt })
      .from(approvalRequests)
      .innerJoin(kycCases, sql`${kycCases.id}::text = ${approvalRequests.subjectId}`)
      .innerJoin(users, eq(users.id, approvalRequests.requestedBy))
      .where(where)
      .orderBy(approvalRequests.requestedAt)
      .limit(limit);
    const [n] = await db.select({ n: count() }).from(approvalRequests).where(where);
    byKind.kyc = n?.n ?? 0;
    for (const r of rows) {
      items.push({ id: r.id, kind: "KYC sign-off", title: r.reference, href: `/kyc/cases/${r.id}`, requestedByName: r.requestedByName, requestedByUsername: r.requestedByUsername, requestedAt: r.requestedAt });
    }
  }
  if (user.permissions.has(flagChangeApproval.approvePermission)) {
    // A change prod has moved past can only be rejected now, so it isn't waiting for approval.
    const where = and(pendingFromOthers(flagChangeApproval.kind), eq(flagValues.version, flagChanges.baseVersion));
    const prodNow = and(eq(flagValues.flagId, flagChanges.flagId), eq(flagValues.environment, flagChanges.environment));
    const rows = await db
      .select({ change: flagChanges, flagKey: flags.key, requestedByName: requesterName, requestedByUsername: users.username, requestedAt: approvalRequests.requestedAt })
      .from(flagChanges)
      .innerJoin(approvalRequests, eq(approvalRequests.id, flagChanges.approvalRequestId))
      .innerJoin(flags, eq(flags.id, flagChanges.flagId))
      .innerJoin(flagValues, prodNow)
      .innerJoin(users, eq(users.id, approvalRequests.requestedBy))
      .where(where)
      .orderBy(approvalRequests.requestedAt)
      .limit(limit);
    const [n] = await db
      .select({ n: count() })
      .from(flagChanges)
      .innerJoin(approvalRequests, eq(approvalRequests.id, flagChanges.approvalRequestId))
      .innerJoin(flagValues, prodNow)
      .where(where);
    byKind.flags = n?.n ?? 0;
    for (const { change: c, ...r } of rows) {
      const before = describeFlagValue({ enabled: c.beforeEnabled, rolloutPercentage: c.beforeRolloutPercentage });
      const after = describeFlagValue({ enabled: c.afterEnabled, rolloutPercentage: c.afterRolloutPercentage });
      items.push({
        id: c.id,
        kind: "Flag change",
        title: `${r.flagKey}: ${c.environment} ${before} → ${after}`,
        href: `/flags/${c.flagId}`,
        requestedByName: r.requestedByName,
        requestedByUsername: r.requestedByUsername,
        requestedAt: r.requestedAt,
      });
    }
  }
  items.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
  return { items: items.slice(0, limit), total: byKind.refunds + byKind.kyc + byKind.flags, byKind };
}

const RECORD_LINKS: Record<string, { permission: string; href: (id: string) => string }> = {
  refund: { permission: "refunds:read", href: (id) => `/refunds/requests/${id}` },
  payment: { permission: "refunds:read", href: (id) => `/refunds/payments/${id}` },
  kyc_case: { permission: "kyc:read", href: (id) => `/kyc/cases/${id}` },
  flag: { permission: "flags:read", href: (id) => `/flags/${id}` },
};

/** Plain words for audit entity types; anything unlisted shows its raw type. */
const RECORD_LABELS: Record<string, string> = {
  refund: "Refund",
  payment: "Payment",
  kyc_case: "KYC case",
  kyc_document: "KYC document",
  flag: "Feature flag",
  approval_request: "Approval",
};

/**
 * The user's own latest work: audit rows they wrote, minus sign-ins, sign-outs, denials and old demo/sample rows.
 * Only their own, so no one sees others' activity without audit:read.
 */
export async function myRecentActivity(db: Db, user: Viewer): Promise<ActivityItem[]> {
  const rows = await db
    .select({ id: auditLog.id, occurredAt: auditLog.occurredAt, action: auditLog.action, entityType: auditLog.entityType, entityId: auditLog.entityId })
    .from(auditLog)
    .where(and(eq(auditLog.actorUserId, user.id), notLike(auditLog.action, "auth.%"), ne(auditLog.action, "access.denied"), ne(auditLog.action, "seed.sample"), notLike(auditLog.action, "demo.%")))
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
    .limit(LIMIT);
  return rows.map((r) => {
    const link = RECORD_LINKS[r.entityType];
    return {
      id: r.id,
      occurredAt: r.occurredAt,
      action: r.action,
      record: `${RECORD_LABELS[r.entityType] ?? r.entityType} ${r.entityId.length > 24 ? r.entityId.slice(0, 8) : r.entityId}`,
      href: link && user.permissions.has(link.permission as never) ? link.href(r.entityId) : null,
    };
  });
}

/** Cases an analyst could pick up now (open or escalated). */
export async function claimableKycCases(db: Db): Promise<number> {
  const [n] = await db.select({ n: count() }).from(kycCases).where(inArray(kycCases.status, ["open", "escalated"]));
  return n?.n ?? 0;
}
