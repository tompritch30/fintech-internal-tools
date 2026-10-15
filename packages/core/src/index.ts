export * from "./errors.ts";
export * from "./config.ts";
export * from "./auth/oidc.ts";
export * from "./session/session.ts";
export * from "./rbac/permissions.ts";
export * from "./rbac/guards.ts";
export * from "./rbac/define-action.ts";
export { withAudit, type Actor, type AuditEntry } from "./audit/with-audit.ts";
export * from "./audit/queries.ts";
export * from "./approvals/approvals.ts";
export { DEFAULT_UNMASK_RATE_LIMIT_PER_HOUR, unmaskRateLimit } from "./masking/rate-limit.ts";
export { MIN_UNMASK_REASON_LENGTH } from "./masking/reason.ts";
// masking is deliberately NOT exported here: it imports `server-only`, which
// throws under plain Node (web vitest, next.config). Use `@fit/core/masking`.
