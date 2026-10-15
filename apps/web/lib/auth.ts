import "server-only";
import type { Configuration } from "openid-client";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createDb, type Db } from "@fit/db";
import {
  createDefineAction,
  discoverOidc,
  ForbiddenError,
  getSessionUser,
  loadConfig,
  requirePermission,
  SESSION_COOKIE,
  type CoreConfig,
  type Permission,
  type SessionUser,
} from "@fit/core";

const cache = globalThis as unknown as { fitConfig?: CoreConfig; fitDb?: Db; fitOidc?: Promise<Configuration> };

export function getConfig(): CoreConfig {
  return (cache.fitConfig ??= loadConfig());
}

export function getDb(): Db {
  return (cache.fitDb ??= createDb(getConfig().databaseUrl));
}

export function getOidc(): Promise<Configuration> {
  cache.fitOidc ??= discoverOidc(getConfig().oidc).catch((err: unknown) => {
    cache.fitOidc = undefined;
    throw err;
  });
  return cache.fitOidc;
}

export async function getCurrentUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return getSessionUser(getDb(), token);
}

/** Signed-in user, or redirect to /login. */
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** For pages: checks the permission on the server; denied users go to /no-access (and are audited). */
export async function requirePagePermission(permission: Permission, resource: string): Promise<SessionUser> {
  const user = await requireUser();
  try {
    return await requirePermission(
      { db: getDb(), user, resource },
      permission,
    );
  } catch (err) {
    if (err instanceof ForbiddenError) redirect("/no-access");
    throw err;
  }
}

/** Every exported server action must be built with this (enforced by test/actions-use-define-action.test.ts). */
export const defineAction = createDefineAction(async () => ({ db: getDb(), user: await getCurrentUser() }));

export function sessionCookieOptions(expires: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: getConfig().appUrl.startsWith("https://"),
    path: "/",
    expires,
  };
}
