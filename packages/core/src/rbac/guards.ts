import type { Db } from "@fit/db";
import { insertAuditRow } from "../audit/with-audit.ts";
import { ForbiddenError, UnauthenticatedError } from "../errors.ts";
import type { SessionUser } from "../session/session.ts";
import type { Permission, Role } from "./permissions.ts";

export interface GuardContext {
  db: Db;
  user: SessionUser | null;
  /** Route path or action name, recorded on access.denied rows. */
  resource: string;
  /** True for Next.js prefetch requests: still denied, but not audited. */
  isPrefetch?: boolean;
}

async function deny(ctx: GuardContext, user: SessionUser, required: string): Promise<never> {
  if (!ctx.isPrefetch) {
    await insertAuditRow(ctx.db, {
      actor: { id: user.id, subject: user.subject },
      action: "access.denied",
      entityType: "resource",
      entityId: ctx.resource,
      metadata: { required, roles: user.roles },
    });
  }
  throw new ForbiddenError(required);
}

export async function requirePermission(ctx: GuardContext, permission: Permission): Promise<SessionUser> {
  const { user } = ctx;
  if (!user) throw new UnauthenticatedError();
  if (!user.permissions.has(permission)) return deny(ctx, user, `permission:${permission}`);
  return user;
}

export async function requireRole(ctx: GuardContext, role: Role): Promise<SessionUser> {
  const { user } = ctx;
  if (!user) throw new UnauthenticatedError();
  if (!user.roles.includes(role)) return deny(ctx, user, `role:${role}`);
  return user;
}
