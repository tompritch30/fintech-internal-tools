import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, inArray, sql } from "drizzle-orm";
import { roles as rolesTable, sessions, userRoles, users, type Db, type Executor } from "@fit/db";
import type { IdentityClaims } from "../auth/oidc.ts";
import { permissionsFor, type Permission } from "../rbac/permissions.ts";

export { SESSION_COOKIE } from "./cookie.ts";

export interface SessionUser {
  id: string;
  subject: string;
  username: string;
  displayName: string | null;
  email: string | null;
  roles: string[];
  permissions: Set<Permission>;
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Upserts the user from IdP claims and replaces their roles with the IdP's. */
export async function syncUserFromClaims(
  tx: Executor,
  claims: Pick<IdentityClaims, "subject" | "username" | "email" | "displayName" | "roles">,
): Promise<{ id: string; roles: string[] }> {
  const [user] = await tx
    .insert(users)
    .values({
      subject: claims.subject,
      username: claims.username,
      email: claims.email,
      displayName: claims.displayName,
      lastLoginAt: new Date(),
    })
    .onConflictDoUpdate({
      target: users.subject,
      set: {
        username: claims.username,
        email: claims.email,
        displayName: claims.displayName,
        lastLoginAt: new Date(),
      },
    })
    .returning({ id: users.id });
  if (!user) throw new Error("Could not upsert user");

  const known =
    claims.roles.length === 0
      ? []
      : (await tx.select({ name: rolesTable.name }).from(rolesTable).where(inArray(rolesTable.name, claims.roles))).map(
          (r) => r.name,
        );
  await tx.delete(userRoles).where(eq(userRoles.userId, user.id));
  if (known.length > 0) {
    await tx.insert(userRoles).values(known.map((roleName) => ({ userId: user.id, roleName })));
  }
  return { id: user.id, roles: known };
}

export async function createSession(
  tx: Executor,
  userId: string,
  ttlHours: number,
  idToken?: string,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlHours * 3600_000);
  await tx.insert(sessions).values({ id: hashToken(token), userId, expiresAt, idToken });
  return { token, expiresAt };
}

/** Returns the signed-in user for a session token, or null if missing/expired/revoked. */
export async function getSessionUser(db: Db, token: string | undefined | null): Promise<SessionUser | null> {
  if (!token) return null;
  const rows = await db
    .select({
      id: users.id,
      subject: users.subject,
      username: users.username,
      displayName: users.displayName,
      email: users.email,
      role: userRoles.roleName,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .leftJoin(userRoles, eq(userRoles.userId, users.id))
    .where(and(eq(sessions.id, hashToken(token)), gt(sessions.expiresAt, sql`now()`)));
  const first = rows[0];
  if (!first) return null;
  const roles = rows.map((r) => r.role).filter((r): r is string => r !== null);
  return {
    id: first.id,
    subject: first.subject,
    username: first.username,
    displayName: first.displayName,
    email: first.email,
    roles,
    permissions: permissionsFor(roles),
  };
}

/** Deletes the session. Returns its ID token (for the IdP logout hint), if any. */
export async function revokeSession(
  tx: Executor,
  token: string,
): Promise<{ userId: string; idToken: string | null } | null> {
  const [row] = await tx
    .delete(sessions)
    .where(eq(sessions.id, hashToken(token)))
    .returning({ userId: sessions.userId, idToken: sessions.idToken });
  return row ?? null;
}
