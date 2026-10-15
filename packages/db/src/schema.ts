import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** The IdP's stable subject (`sub`) for this user. */
  subject: text("subject").notNull().unique(),
  username: text("username").notNull(),
  email: text("email"),
  displayName: text("display_name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
});

export const roles = pgTable("roles", {
  name: text("name").primaryKey(),
  description: text("description").notNull(),
});

export const userRoles = pgTable(
  "user_roles",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    roleName: text("role_name")
      .notNull()
      .references(() => roles.name),
  },
  (t) => [primaryKey({ columns: [t.userId, t.roleName] })],
);

export const sessions = pgTable(
  "sessions",
  {
    /** SHA-256 (hex) of the session token. The token itself is only in the cookie. */
    id: text("id").primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /** Kept only to send as id_token_hint on logout. */
    idToken: text("id_token"),
  },
  (t) => [index("sessions_user_id_idx").on(t.userId)],
);

/**
 * Append-only. UPDATE/DELETE/TRUNCATE are blocked by triggers and grants
 * (see migrations/0001_audit_append_only.sql). Write only via @fit/core audit.
 */
export const auditLog = pgTable(
  "audit_log",
  {
    id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestamp("occurred_at", { withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    actorUserId: uuid("actor_user_id").references(() => users.id),
    actorSubject: text("actor_subject"),
    action: text("action").notNull(),
    entityType: text("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    reason: text("reason"),
    before: jsonb("before"),
    after: jsonb("after"),
    metadata: jsonb("metadata"),
  },
  (t) => [
    index("audit_log_entity_idx").on(t.entityType, t.entityId),
    index("audit_log_occurred_at_idx").on(t.occurredAt),
  ],
);

export const approvalStatus = pgEnum("approval_status", [
  "pending",
  "approved",
  "rejected",
  "cancelled",
]);

/**
 * Maker-checker approvals (ARCHITECTURE.md §4.2). The requester can never decide:
 * enforced in code (SelfApprovalError) and by maker_is_not_checker. Content and
 * status transitions are additionally guarded by a trigger (0003_approvals_guard.sql);
 * app_runtime has no DELETE grant.
 */
export const approvalRequests = pgTable(
  "approval_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Which approval kind created the request, e.g. 'refund.issue'. */
    kind: text("kind").notNull(),
    /** The app's entity type the request is about, e.g. 'refund'. */
    subjectType: text("subject_type").notNull(),
    subjectId: text("subject_id").notNull(),
    /** What will happen if approved. Never copied into audit rows. */
    payload: jsonb("payload").notNull(),
    status: approvalStatus("status").notNull().default("pending"),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedBy: uuid("decided_by").references(() => users.id),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    /** Optimistic concurrency: decides must pass the version they saw. */
    version: integer("version").notNull().default(1),
  },
  (t) => [
    index("approval_requests_status_kind_idx").on(t.status, t.kind),
    index("approval_requests_subject_idx").on(t.subjectType, t.subjectId),
    check("maker_is_not_checker", sql`${t.decidedBy} is null or ${t.decidedBy} <> ${t.requestedBy}`),
    check(
      "decision_matches_status",
      sql`(${t.status} = 'pending' and ${t.decidedBy} is null and ${t.decidedAt} is null) or (${t.status} in ('approved','rejected') and ${t.decidedBy} is not null and ${t.decidedAt} is not null) or (${t.status} = 'cancelled' and ${t.decidedBy} is null and ${t.decidedAt} is not null)`,
    ),
  ],
);

/**
 * Card payments that can be refunded (refunds app). Dummy data only.
 * Card numbers are never stored: only the brand and last four digits (card_last4 CHECK).
 * customer_email is masked on the server (apps/web refunds module).
 * app_runtime can SELECT and UPDATE only refunded_pence (0005_refunds_guard.sql).
 */
export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human-facing payment reference, e.g. PAY-100001. */
    reference: text("reference").notNull().unique(),
    customerName: text("customer_name").notNull(),
    customerEmail: text("customer_email").notNull(),
    merchant: text("merchant").notNull(),
    cardBrand: text("card_brand").notNull(),
    cardLast4: text("card_last4").notNull(),
    amountPence: integer("amount_pence").notNull(),
    /** Sum of succeeded refunds. Never above amount_pence (payments_refund_within_amount). */
    refundedPence: integer("refunded_pence").notNull().default(0),
    currency: text("currency").notNull().default("GBP"),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
  },
  (t) => [
    check("payments_card_last4_only", sql`${t.cardLast4} ~ '^[0-9]{4}$'`),
    check("payments_amount_positive", sql`${t.amountPence} > 0`),
    check("payments_refund_within_amount", sql`${t.refundedPence} >= 0 and ${t.refundedPence} <= ${t.amountPence}`),
    check("payments_currency_gbp", sql`${t.currency} = 'GBP'`),
    index("payments_captured_at_idx").on(t.capturedAt),
  ],
);

/**
 * Stored refund state. 'rejected' / 'cancelled' are not stored here: they come from the
 * linked approval request, so there is one source of truth for the decision.
 */
export const refundStatus = pgEnum("refund_status", ["pending", "succeeded"]);

/**
 * One refund against a payment. The id is generated when the request form is rendered and
 * doubles as the idempotency key, so a double-submitted form creates one refund.
 * A trigger (0005_refunds_guard.sql) makes content immutable and status one-way.
 */
export const refunds = pgTable(
  "refunds",
  {
    id: uuid("id").primaryKey(),
    paymentId: uuid("payment_id")
      .notNull()
      .references(() => payments.id),
    amountPence: integer("amount_pence").notNull(),
    reason: text("reason").notNull(),
    status: refundStatus("status").notNull().default("pending"),
    requiresApproval: boolean("requires_approval").notNull(),
    approvalRequestId: uuid("approval_request_id").references(() => approvalRequests.id),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    /** The mock provider's refund id, set when money moves. */
    providerRefundId: text("provider_refund_id"),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    index("refunds_payment_id_idx").on(t.paymentId),
    uniqueIndex("refunds_approval_request_id_idx").on(t.approvalRequestId),
    check("refunds_amount_positive", sql`${t.amountPence} > 0`),
    check("refunds_reason_present", sql`length(btrim(${t.reason})) > 0`),
    check("refunds_approval_link", sql`${t.requiresApproval} = (${t.approvalRequestId} is not null)`),
    check(
      "refunds_succeeded_has_provider_ref",
      sql`(${t.status} = 'succeeded') = (${t.providerRefundId} is not null and ${t.processedAt} is not null)`,
    ),
  ],
);

/**
 * The mock payment provider's own ledger: one row per refund it has paid out.
 * unique(refund_id) is the provider-side idempotency key, so a refund can move money once.
 */
export const mockProviderRefunds = pgTable("mock_provider_refunds", {
  id: text("id").primaryKey(),
  refundId: uuid("refund_id").notNull().unique(),
  paymentReference: text("payment_reference").notNull(),
  amountPence: integer("amount_pence").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type User = typeof users.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
export type ApprovalRequestRow = typeof approvalRequests.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type RefundRow = typeof refunds.$inferSelect;
