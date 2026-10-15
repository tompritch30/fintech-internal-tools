import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog } from "@fit/db";
import {
  createDefineAction,
  ForbiddenError,
  requirePermission,
  requireRole,
  UnauthenticatedError,
} from "../src/index.ts";
import { appDb, makeUser, uniqueId } from "./helpers/db.ts";

const db = appDb();

async function deniedRows(userId: string, resource: string) {
  return db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.actorUserId, userId), eq(auditLog.action, "access.denied"), eq(auditLog.entityId, resource)));
}

describe("requirePermission", () => {
  it("denies a user without the permission", async () => {
    const { user } = await makeUser(db, ["analyst"]);
    await expect(requirePermission({ db, user, resource: uniqueId("/audit") }, "audit:read")).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("allows a user with the permission (positive control)", async () => {
    const { user } = await makeUser(db, ["admin"]);
    await expect(requirePermission({ db, user, resource: uniqueId("/audit") }, "audit:read")).resolves.toMatchObject({
      id: user.id,
    });
  });

  it("denies a signed-in user with no roles any platform access", async () => {
    const { user } = await makeUser(db, []);
    await expect(requirePermission({ db, user, resource: uniqueId("/") }, "platform:access")).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("rejects an anonymous request as unauthenticated", async () => {
    await expect(requirePermission({ db, user: null, resource: "/" }, "platform:access")).rejects.toThrow(
      UnauthenticatedError,
    );
  });

  it("writes an access.denied audit row when it blocks a user", async () => {
    const { user } = await makeUser(db, ["analyst"]);
    const resource = uniqueId("/audit");
    await expect(requirePermission({ db, user, resource }, "audit:read")).rejects.toThrow(ForbiddenError);
    const rows = await deniedRows(user.id, resource);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.metadata).toMatchObject({ required: "permission:audit:read", roles: ["analyst"] });
  });

  it("writes no access.denied row when it allows a user (positive control)", async () => {
    const { user } = await makeUser(db, ["admin"]);
    const resource = uniqueId("/audit");
    await requirePermission({ db, user, resource }, "audit:read");
    expect(await deniedRows(user.id, resource)).toHaveLength(0);
  });

  it("denies a prefetch request but writes no access.denied row", async () => {
    const { user } = await makeUser(db, ["analyst"]);
    const resource = uniqueId("/audit");
    await expect(requirePermission({ db, user, resource, isPrefetch: true }, "audit:read")).rejects.toThrow(
      ForbiddenError,
    );
    expect(await deniedRows(user.id, resource)).toHaveLength(0);
  });
});

describe("requireRole", () => {
  it("denies a user without the role and audits it", async () => {
    const { user } = await makeUser(db, ["analyst"]);
    const resource = uniqueId("/approvals");
    await expect(requireRole({ db, user, resource }, "approver")).rejects.toThrow(ForbiddenError);
    expect(await deniedRows(user.id, resource)).toHaveLength(1);
  });

  it("allows a user with the role (positive control)", async () => {
    const { user } = await makeUser(db, ["approver"]);
    await expect(requireRole({ db, user, resource: uniqueId("/approvals") }, "approver")).resolves.toMatchObject({
      id: user.id,
    });
  });
});

describe("defineAction", () => {
  it("does not run the action body when the user lacks the permission", async () => {
    const { user } = await makeUser(db, ["analyst"]);
    let ran = false;
    const defineAction = createDefineAction(async () => ({ db, user }));
    const action = defineAction("audit:read", uniqueId("test.action"), async () => {
      ran = true;
    });
    await expect(action()).rejects.toThrow(ForbiddenError);
    expect(ran).toBe(false);
  });

  it("runs the action body when the user has the permission (positive control)", async () => {
    const { user } = await makeUser(db, ["admin"]);
    const defineAction = createDefineAction(async () => ({ db, user }));
    const action = defineAction("audit:read", uniqueId("test.action"), async (ctx, n: number) => `${ctx.user.id}:${n}`);
    await expect(action(2)).resolves.toBe(`${user.id}:2`);
  });
});
