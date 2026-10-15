import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  date,
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
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
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
export const refundStatus = pgEnum("refund_status", ["pending", "succeeded", "rejected"]);

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

export const kycRiskRating = pgEnum("kyc_risk_rating", ["low", "medium", "high"]);

/**
 * open → in_review (claimed) → approved | rejected (closed), or → escalated (back in the queue, unowned).
 * High-risk approvals go in_review → pending_approval → approved (signed off) or back to in_review (refused).
 */
export const kycCaseStatus = pgEnum("kyc_case_status", ["open", "in_review", "pending_approval", "escalated", "approved", "rejected"]);

/**
 * KYC review cases (KYC app). Synthetic data only. Date of birth, ID number, address and name
 * are masked on the server (apps/web kyc module). Cases come from the seed (intake is out of scope):
 * app_runtime can SELECT and UPDATE only the workflow columns, never INSERT or DELETE
 * (0009_kyc_guard.sql). A closed case keeps a retention date and can't be deleted, even by app_owner.
 */
export const kycCases = pgTable(
  "kyc_cases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Human-facing case reference, e.g. KYC-200001. */
    reference: text("reference").notNull().unique(),
    applicantName: text("applicant_name").notNull(),
    dateOfBirth: date("date_of_birth", { mode: "string" }).notNull(),
    idNumber: text("id_number").notNull(),
    address: text("address").notNull(),
    /** ISO 3166-1 alpha-2 country code. Not masked. */
    nationality: text("nationality").notNull(),
    riskRating: kycRiskRating("risk_rating").notNull(),
    sanctionsHit: boolean("sanctions_hit").notNull().default(false),
    pep: boolean("pep").notNull().default(false),
    status: kycCaseStatus("status").notNull().default("open"),
    /** The analyst who claimed the case. Only they can decide it. Null while open or escalated. */
    ownerId: uuid("owner_id").references(() => users.id),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    /** Note from the latest decision or escalation (the full trail is in audit_log). */
    decisionNote: text("decision_note"),
    openedAt: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    /** closed_at + KYC_RETENTION_YEARS. Set once, when the case closes. */
    retentionUntil: timestamp("retention_until", { withTimezone: true }),
  },
  (t) => [
    index("kyc_cases_status_idx").on(t.status),
    index("kyc_cases_owner_id_idx").on(t.ownerId),
    check("kyc_cases_owner_matches_status", sql`(${t.status} in ('open', 'escalated')) = (${t.ownerId} is null)`),
    check("kyc_cases_claimed_at_with_owner", sql`(${t.ownerId} is null) = (${t.claimedAt} is null)`),
    check(
      "kyc_cases_closed_has_retention",
      sql`(${t.status} in ('approved', 'rejected')) = (${t.closedAt} is not null and ${t.retentionUntil} is not null)`,
    ),
    check("kyc_cases_retention_at_least_5_years", sql`${t.retentionUntil} is null or ${t.retentionUntil} >= ${t.closedAt} + interval '5 years'`),
    check("kyc_cases_rejection_has_note", sql`${t.status} <> 'rejected' or length(btrim(coalesce(${t.decisionNote}, ''))) > 0`),
    check("kyc_cases_nationality_code", sql`${t.nationality} ~ '^[A-Z]{2}$'`),
  ],
);

/** Synthetic identity documents attached to a case. Read-only for app_runtime; opening one is audited. */
export const kycDocuments = pgTable(
  "kyc_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => kycCases.id),
    kind: text("kind").notNull(),
    fileName: text("file_name").notNull(),
    /** The document's (synthetic) text. Masked in full; opening it needs a reason. */
    content: text("content").notNull(),
    uploadedAt: timestamp("uploaded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("kyc_documents_case_id_idx").on(t.caseId),
    check("kyc_documents_kind", sql`${t.kind} in ('passport', 'driving_licence', 'utility_bill', 'bank_statement')`),
  ],
);

/** Feature flags app (apps/web flags). Environments every flag holds a value for. */
export const flagEnvironment = pgEnum("flag_environment", ["dev", "staging", "prod"]);

/** One feature flag. Created by the seed (app_owner) only; app_runtime can only SELECT. Dummy data only. */
export const flags = pgTable(
  "flags",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Stable key services ask for, e.g. new-checkout-flow. */
    key: text("key").notNull().unique(),
    description: text("description").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("flags_key_format", sql`${t.key} ~ '^[a-z][a-z0-9-]{1,62}$'`)],
);

/**
 * A flag's current value in one environment: exactly one row per (flag, environment), created
 * with the flag. app_runtime can UPDATE only the value columns (0011_flags_guard.sql); every
 * update must bump version by one, which gives optimistic concurrency and stale-approval checks.
 */
export const flagValues = pgTable(
  "flag_values",
  {
    flagId: uuid("flag_id")
      .notNull()
      .references(() => flags.id),
    environment: flagEnvironment("environment").notNull(),
    enabled: boolean("enabled").notNull().default(false),
    /** Share of traffic that gets the flag when enabled: a whole number from 0 to 100. */
    rolloutPercentage: integer("rollout_percentage").notNull().default(0),
    version: integer("version").notNull().default(1),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id),
  },
  (t) => [
    primaryKey({ columns: [t.flagId, t.environment] }),
    check("flag_values_rollout_range", sql`${t.rolloutPercentage} between 0 and 100`),
  ],
);

export const flagChangeStatus = pgEnum("flag_change_status", ["pending", "applied", "rejected"]);

/**
 * A prod change waiting for (or decided by) a second person. The id is minted when the form
 * renders (idempotency key). One pending change per flag and environment; content is immutable
 * and status moves pending -> applied | rejected only (0011_flags_guard.sql).
 */
export const flagChanges = pgTable(
  "flag_changes",
  {
    id: uuid("id").primaryKey(),
    flagId: uuid("flag_id")
      .notNull()
      .references(() => flags.id),
    environment: flagEnvironment("environment").notNull(),
    beforeEnabled: boolean("before_enabled").notNull(),
    beforeRolloutPercentage: integer("before_rollout_percentage").notNull(),
    afterEnabled: boolean("after_enabled").notNull(),
    afterRolloutPercentage: integer("after_rollout_percentage").notNull(),
    /** flag_values.version the change was requested against; approval fails if prod moved since. */
    baseVersion: integer("base_version").notNull(),
    reason: text("reason").notNull(),
    status: flagChangeStatus("status").notNull().default("pending"),
    approvalRequestId: uuid("approval_request_id")
      .notNull()
      .references(() => approvalRequests.id),
    requestedBy: uuid("requested_by")
      .notNull()
      .references(() => users.id),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("flag_changes_approval_request_id_idx").on(t.approvalRequestId),
    uniqueIndex("flag_changes_one_pending_idx").on(t.flagId, t.environment).where(sql`${t.status} = 'pending'`),
    check("flag_changes_prod_only", sql`${t.environment} = 'prod'`),
    check("flag_changes_rollout_range", sql`${t.afterRolloutPercentage} between 0 and 100 and ${t.beforeRolloutPercentage} between 0 and 100`),
    check("flag_changes_reason_present", sql`length(btrim(${t.reason})) > 0`),
    check("flag_changes_decided_at", sql`(${t.status} = 'pending') = (${t.decidedAt} is null)`),
  ],
);

export type User = typeof users.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
export type ApprovalRequestRow = typeof approvalRequests.$inferSelect;
export type PaymentRow = typeof payments.$inferSelect;
export type RefundRow = typeof refunds.$inferSelect;
export type KycCaseRow = typeof kycCases.$inferSelect;
export type KycDocumentRow = typeof kycDocuments.$inferSelect;
export type FlagRow = typeof flags.$inferSelect;
export type FlagValueRow = typeof flagValues.$inferSelect;
export type FlagChangeRow = typeof flagChanges.$inferSelect;
export type FlagEnvironment = (typeof flagEnvironment.enumValues)[number];
