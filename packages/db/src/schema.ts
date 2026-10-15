import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
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

export type User = typeof users.$inferSelect;
export type AuditLogRow = typeof auditLog.$inferSelect;
export type NewAuditLogRow = typeof auditLog.$inferInsert;
export type ApprovalRequestRow = typeof approvalRequests.$inferSelect;
