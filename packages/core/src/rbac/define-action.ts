import type { Db } from "@fit/db";
import type { SessionUser } from "../session/session.ts";
import { requirePermission } from "./guards.ts";
import type { Permission } from "./permissions.ts";

export interface ActionContext {
  db: Db;
  user: SessionUser;
}

export type ContextLoader = () => Promise<{ db: Db; user: SessionUser | null }>;

/**
 * Builds `defineAction` for an app. Every server action must be created with it:
 *   export const addNote = defineAction("platform:access", "demo.addNote", async (ctx, input) => { ... })
 * The permission check runs on the server before the action body, every time.
 */
export function createDefineAction(load: ContextLoader) {
  return function defineAction<A extends unknown[], R>(
    permission: Permission,
    name: string,
    fn: (ctx: ActionContext, ...args: A) => Promise<R>,
  ): (...args: A) => Promise<R> {
    return async (...args: A) => {
      const { db, user } = await load();
      const authorised = await requirePermission({ db, user, resource: `action:${name}` }, permission);
      return fn({ db, user: authorised }, ...args);
    };
  };
}
