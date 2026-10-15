import "server-only";
import { and, count, desc, eq, inArray, ne, notLike, sql } from "drizzle-orm";
import type { SessionUser } from "@fit/core";
import { approvalRequests, auditLog, kycCases, payments, refunds, users, type Db } from "@fit/db";
import { kycApproval } from "./kyc/kyc.ts";
import { refundApproval } from "./refunds/refunds.ts";

type Viewer = Pick<SessionUser, "id" | "permissions">;

export interface AwaitingItem {
  id: string;
  kind: "Refund" | "KYC sign-off";
  title: string;
  href: string;
  requestedByName: string;
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
export async function awaitingMyApproval(db: Db, user: Viewer, opts: { limit?: number } = {}): Promise<{ items: AwaitingItem[]; total: number; byKind: { refunds: number; kyc: number } }> {
  const limit = opts.limit ?? LIMIT;
  const pendingFromOthers = (kind: string) =>
    and(eq(approvalRequests.kind, kind), eq(approvalRequests.status, "pending"), ne(approvalRequests.requestedBy, user.id));
  const items: AwaitingItem[] = [];
  const byKind = { refunds: 0, kyc: 0 };
  if (user.permissions.has(refundApproval.approvePermission)) {
    const where = pendingFromOthers(refundApproval.kind);
    const rows = await db
      .select({ id: refunds.id, reference: payments.reference, amountPence: refunds.amountPence, requestedByName: requesterName, requestedAt: approvalRequests.requestedAt })
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
        requestedAt: r.requestedAt,
      });
    }
  }
  if (user.permissions.has(kycApproval.approvePermission)) {
    const where = pendingFromOthers(kycApproval.kind);
    const rows = await db
      .select({ id: kycCases.id, reference: kycCases.reference, requestedByName: requesterName, requestedAt: approvalRequests.requestedAt })
      .from(approvalRequests)
      .innerJoin(kycCases, sql`${kycCases.id}::text = ${approvalRequests.subjectId}`)
      .innerJoin(users, eq(users.id, approvalRequests.requestedBy))
      .where(where)
      .orderBy(approvalRequests.requestedAt)
      .limit(limit);
    const [n] = await db.select({ n: count() }).from(approvalRequests).where(where);
    byKind.kyc = n?.n ?? 0;
    for (const r of rows) {
      items.push({ id: r.id, kind: "KYC sign-off", title: r.reference, href: `/kyc/cases/${r.id}`, requestedByName: r.requestedByName, requestedAt: r.requestedAt });
    }
  }
  items.sort((a, b) => a.requestedAt.getTime() - b.requestedAt.getTime());
  return { items: items.slice(0, limit), total: byKind.refunds + byKind.kyc, byKind };
}

const RECORD_LINKS: Record<string, { permission: string; href: (id: string) => string }> = {
  refund: { permission: "refunds:read", href: (id) => `/refunds/requests/${id}` },
  payment: { permission: "refunds:read", href: (id) => `/refunds/payments/${id}` },
  kyc_case: { permission: "kyc:read", href: (id) => `/kyc/cases/${id}` },
};

/**
 * The user's own latest work: audit rows they wrote, minus sign-ins, sign-outs and denials.
 * Only their own, so no one sees others' activity without audit:read.
 */
export async function myRecentActivity(db: Db, user: Viewer): Promise<ActivityItem[]> {
  const rows = await db
    .select({ id: auditLog.id, occurredAt: auditLog.occurredAt, action: auditLog.action, entityType: auditLog.entityType, entityId: auditLog.entityId })
    .from(auditLog)
    .where(and(eq(auditLog.actorUserId, user.id), notLike(auditLog.action, "auth.%"), ne(auditLog.action, "access.denied")))
    .orderBy(desc(auditLog.occurredAt), desc(auditLog.id))
    .limit(LIMIT);
  return rows.map((r) => {
    const link = RECORD_LINKS[r.entityType];
    return {
      id: r.id,
      occurredAt: r.occurredAt,
      action: r.action,
      record: `${r.entityType} ${r.entityId.length > 24 ? r.entityId.slice(0, 8) : r.entityId}`,
      href: link && user.permissions.has(link.permission as never) ? link.href(r.entityId) : null,
    };
  });
}

/** Cases an analyst could pick up now (open or escalated). */
export async function claimableKycCases(db: Db): Promise<number> {
  const [n] = await db.select({ n: count() }).from(kycCases).where(inArray(kycCases.status, ["open", "escalated"]));
  return n?.n ?? 0;
}
