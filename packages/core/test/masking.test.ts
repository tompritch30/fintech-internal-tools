import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, users } from "@fit/db";
import { ForbiddenError, MIN_UNMASK_REASON_LENGTH, NotFoundError, ValidationError } from "../src/index.ts";
import { defineMaskedEntity, mask, unmask } from "../src/masking/masking.ts";
import { appDb, makeUser, ownerDb, uniqueId } from "./helpers/db.ts";

const db = appDb();
const owner = ownerDb();

const userEntity = defineMaskedEntity<{ id: string; email: string | null }>({
  entityType: "user",
  policies: [{ field: "email", style: "email", unmaskPermission: "pii:unmask" }],
  load: async (tx, id) =>
    (await tx.select({ id: users.id, email: users.email }).from(users).where(eq(users.id, id)))[0] ?? null,
});

async function userWithEmail() {
  const { user } = await makeUser(db, ["analyst"]);
  const email = `${uniqueId("cust")}@example.test`;
  await db.update(users).set({ email }).where(eq(users.id, user.id));
  return { id: user.id, email };
}

const unmaskAuditRows = (entityId: string) =>
  db.select().from(auditLog).where(and(eq(auditLog.entityId, entityId), eq(auditLog.action, "field.unmask")));
const deniedRows = (resource: string) =>
  db
    .select()
    .from(auditLog)
    .where(and(eq(auditLog.entityId, resource), eq(auditLog.action, "access.denied")));

describe("mask", () => {
  it("masked output contains none of the raw values", () => {
    const record = { iban: "GB00TEST12345678", email: "alice@example.test", name: "Alice Test" };
    const output = mask(record, [
      { field: "iban", style: "last4", unmaskPermission: "pii:unmask" },
      { field: "email", style: "email", unmaskPermission: "pii:unmask" },
      { field: "name", style: "full", unmaskPermission: "pii:unmask" },
    ]);
    const json = JSON.stringify(output);
    for (const raw of Object.values(record)) expect(json).not.toContain(raw);
    expect(record).toEqual({ iban: "GB00TEST12345678", email: "alice@example.test", name: "Alice Test" });
  });

  it("passes unmasked fields through unchanged", () => {
    const record = { id: "abc", email: "alice@example.test", balance: 42 };
    const output = mask(record, [{ field: "email", style: "email", unmaskPermission: "pii:unmask" }]);
    expect(output.id).toBe("abc");
    expect(output.balance).toBe(42);
  });

  it.each([
    ["GB00TEST12345678", "last4", "••••5678"],
    ["1234567", "last4", "••••••••"],
    ["12345678", "last4", "••••5678"],
    ["secret", "full", "••••••••"],
    ["x", "full", "••••••••"],
    ["alice@example.test", "email", "a•••@example.test"],
    ["ab@example.test", "email", "a•••@example.test"],
    ["a@example.test", "email", "•••@example.test"],
    ["not-an-email", "email", "••••••••"],
  ] as const)("masks %s (%s) as %s", (value, style, expected) => {
    const output = mask({ v: value }, [{ field: "v", style, unmaskPermission: "pii:unmask" }]);
    expect(output.v).toBe(expected);
  });

  it("refuses a record with an unpoliced nested object", () => {
    const policies = [{ field: "email", style: "email", unmaskPermission: "pii:unmask" }] as const;
    // `as never` bypasses the compile-time guard to exercise the runtime one.
    expect(() =>
      mask<{ id: string; email: string }, typeof policies>(
        { id: "1", email: "a@example.test", address: { line1: "1 Test Street" } } as never,
        policies,
      ),
    ).toThrow(ValidationError);
    expect(() =>
      mask<{ id: string; email: string }, typeof policies>(
        { id: "1", tags: ["b@example.test"] } as never,
        policies,
      ),
    ).toThrow(ValidationError);
  });

  it("masks a record whose only object fields are Dates", () => {
    const createdAt = new Date("2026-01-02T03:04:05Z");
    const output = mask({ email: "alice@example.test", createdAt }, [
      { field: "email", style: "email", unmaskPermission: "pii:unmask" },
    ]);
    expect(output.createdAt).toBe(createdAt);
    expect(output.email).toBe("a•••@example.test");
  });

  it("masks a nested record by masking each part separately", () => {
    const customer = { id: "1", email: "alice@example.test" };
    const address = { line1: "1 Test Street", postcode: "TE5T 1NG" };
    const maskedCustomer = mask(customer, [
      { field: "email", style: "email", unmaskPermission: "pii:unmask" },
    ]);
    const maskedAddress = mask(address, [
      { field: "line1", style: "full", unmaskPermission: "pii:unmask" },
      { field: "postcode", style: "last4", unmaskPermission: "pii:unmask" },
    ]);
    const combined = { ...maskedCustomer, address: maskedAddress };
    const json = JSON.stringify(combined);
    for (const raw of ["alice@example.test", "1 Test Street", "TE5T 1NG"]) expect(json).not.toContain(raw);
  });

  it("leaves null and undefined values as they are", () => {
    const record: { a: string | null; b?: string } = { a: null };
    const output = mask(record, [
      { field: "a", style: "full", unmaskPermission: "pii:unmask" },
      { field: "b", style: "full", unmaskPermission: "pii:unmask" },
    ]);
    expect(output.a).toBeNull();
    expect(output.b).toBeUndefined();
  });
});

describe("name style", () => {
  const policy = [{ field: "name", style: "name", unmaskPermission: "pii:unmask" }] as const;
  const masked = (name: string) => mask({ id: "1", name }, policy).name;

  it("shows only the first name and the last name's initial", () => {
    expect(masked("Jane Smith")).toBe("Jane S.");
    expect(masked("  Mary Jo   van der Berg ")).toBe("Mary B.");
    expect(masked("Siân O'Neill")).toBe("Siân O.");
  });

  it("never shows a single-word name in full", () => {
    expect(masked("Cher")).toBe("C•••");
    expect(masked("   ")).toBe("••••••••");
  });
});

describe("unmask", () => {
  it("rejects unmask without the field's unmask permission", async () => {
    const { id } = await userWithEmail();
    const { user: analystUser } = await makeUser(db, ["analyst"]);
    await expect(
      unmask(db, analystUser, userEntity, { entityId: id, field: "email", reason: "investigating" }),
    ).rejects.toThrow(ForbiddenError);
    const denied = await deniedRows(`unmask:user:${id}:email`);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ actorUserId: analystUser.id, metadata: { required: "permission:pii:unmask" } });
    expect(await unmaskAuditRows(id)).toHaveLength(0);
  });

  it("rejects unmask by an admin without the unmask permission (no admin bypass)", async () => {
    const { id } = await userWithEmail();
    const { user: admin } = await makeUser(db, ["admin"]);
    await expect(
      unmask(db, admin, userEntity, { entityId: id, field: "email", reason: "investigating" }),
    ).rejects.toThrow(ForbiddenError);
    expect(await unmaskAuditRows(id)).toHaveLength(0);
  });

  it("returns the raw value to a user with the unmask permission", async () => {
    const { id, email } = await userWithEmail();
    const { user: approverUser } = await makeUser(db, ["approver"]);
    const value = await unmask(db, approverUser, userEntity, { entityId: id, field: "email", reason: "case work review" });
    expect(value).toBe(email);
  });

  it.each(["", "   "])("rejects unmask with an empty or blank reason (%j)", async (reason) => {
    const { id } = await userWithEmail();
    const { user: approverUser } = await makeUser(db, ["approver"]);
    await expect(
      unmask(db, approverUser, userEntity, { entityId: id, field: "email", reason }),
    ).rejects.toThrow(ValidationError);
    expect(await unmaskAuditRows(id)).toHaveLength(0);
  });

  it("refuses an unmask reason shorter than 10 characters and writes no audit row", async () => {
    const { id } = await userWithEmail();
    const { user } = await makeUser(db, ["approver"]);
    expect(Array.from("too short")).toHaveLength(MIN_UNMASK_REASON_LENGTH - 1);

    for (const reason of ["too short", "   x    "]) {
      await expect(unmask(db, user, userEntity, { entityId: id, field: "email", reason }))
        .rejects.toThrow("unmasking requires a reason of at least 10 characters");
    }

    expect(await unmaskAuditRows(id)).toHaveLength(0);
  });

  it("accepts a reason of exactly 10 characters", async () => {
    const { id, email } = await userWithEmail();
    const { user } = await makeUser(db, ["approver"]);

    await expect(unmask(db, user, userEntity, { entityId: id, field: "email", reason: "ticket 123" }))
      .resolves.toBe(email);
    expect(await unmaskAuditRows(id)).toHaveLength(1);
  });

  it("writes a field.unmask audit row with the reason and never the value", async () => {
    const { id, email } = await userWithEmail();
    const { user: approverUser } = await makeUser(db, ["approver"]);
    await unmask(db, approverUser, userEntity, { entityId: id, field: "email", reason: "  case work review  " });
    const rows = await unmaskAuditRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: approverUser.id,
      actorSubject: approverUser.subject,
      entityType: "user",
      entityId: id,
      reason: "case work review",
      metadata: { field: "email" },
      before: null,
      after: null,
    });
    expect(JSON.stringify(rows[0])).not.toContain(email);
  });

  it("returns no value when its audit row can't be written", async () => {
    const { id } = await userWithEmail();
    const { user: approverUser } = await makeUser(db, ["approver"]);
    // actorUserId must reference a real user, so the audit insert fails.
    const ghost = { ...approverUser, id: "00000000-0000-4000-8000-000000000000" };
    await expect(
      unmask(db, ghost, userEntity, { entityId: id, field: "email", reason: "case work review" }),
    ).rejects.toThrow();
    expect(await unmaskAuditRows(id)).toHaveLength(0);
  });

  it("rejects unmask of a field without a policy", async () => {
    const { id } = await userWithEmail();
    const { user: approverUser } = await makeUser(db, ["approver"]);
    await expect(
      unmask(db, approverUser, userEntity, { entityId: id, field: "username", reason: "case work review" }),
    ).rejects.toThrow(ValidationError);
    expect(await unmaskAuditRows(id)).toHaveLength(0);
  });

  it("writes no audit row when the record does not exist", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    const { user: approverUser } = await makeUser(db, ["approver"]);
    await expect(
      unmask(db, approverUser, userEntity, { entityId: missing, field: "email", reason: "case work review" }),
    ).rejects.toThrow(NotFoundError);
    expect(await unmaskAuditRows(missing)).toHaveLength(0);
  });
  it("refuses a 21st unmask by the same user within the hour and audits the denial", async () => {
    const { id } = await userWithEmail();
    const { user } = await makeUser(db, ["approver"]);
    for (let i = 0; i < 20; i++) {
      await unmask(db, user, userEntity, { entityId: id, field: "email", reason: "case work review" });
    }

    await expect(unmask(db, user, userEntity, { entityId: id, field: "email", reason: "case work review" }))
      .rejects.toThrow(ForbiddenError);

    const unmaskRows = await db.select().from(auditLog).where(
      and(eq(auditLog.actorUserId, user.id), eq(auditLog.action, "field.unmask")),
    );
    expect(unmaskRows).toHaveLength(20);
    const denied = await deniedRows(`unmask:user:${id}:email`);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({
      actorUserId: user.id,
      metadata: { required: "unmask:rate-limit" },
    });
  });

  it("allows a different user to unmask after another user hits the limit", async () => {
    const { id, email } = await userWithEmail();
    const { user: first } = await makeUser(db, ["approver"]);
    const { user: second } = await makeUser(db, ["approver"]);
    for (let i = 0; i < 20; i++) {
      await unmask(db, first, userEntity, { entityId: id, field: "email", reason: "case work review" });
    }

    await expect(unmask(db, second, userEntity, { entityId: id, field: "email", reason: "case work review" }))
      .resolves.toBe(email);
  });

  it("does not let concurrent unmasks overshoot the limit", async () => {
    const { id } = await userWithEmail();
    const { user } = await makeUser(db, ["approver"]);
    const results = await Promise.allSettled(
      Array.from({ length: 25 }, () =>
        unmask(db, user, userEntity, { entityId: id, field: "email", reason: "case work review" }),
      ),
    );

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(20);
    const rows = await db.select().from(auditLog).where(
      and(eq(auditLog.actorUserId, user.id), eq(auditLog.action, "field.unmask")),
    );
    expect(rows).toHaveLength(20);
  });

  it("does not count field.unmask rows older than the rate-limit window", async () => {
    const { id, email } = await userWithEmail();
    const { user } = await makeUser(db, ["approver"]);
    await owner.insert(auditLog).values(
      Array.from({ length: 20 }, () => ({
        actorUserId: user.id,
        actorSubject: user.subject,
        action: "field.unmask",
        entityType: "user",
        entityId: id,
        reason: "historic unmask",
        metadata: { field: "email" },
        occurredAt: new Date(Date.now() - 61 * 60 * 1000),
      })),
    );

    await expect(unmask(db, user, userEntity, { entityId: id, field: "email", reason: "case work review" }))
      .resolves.toBe(email);
  });

  it("reads the per-user limit from UNMASK_RATE_LIMIT_PER_HOUR", async () => {
    const { id } = await userWithEmail();
    const { user } = await makeUser(db, ["approver"]);
    const previous = process.env.UNMASK_RATE_LIMIT_PER_HOUR;
    process.env.UNMASK_RATE_LIMIT_PER_HOUR = "3";

    try {
      for (let i = 0; i < 3; i++) {
        await unmask(db, user, userEntity, { entityId: id, field: "email", reason: "case work review" });
      }
      await expect(unmask(db, user, userEntity, { entityId: id, field: "email", reason: "case work review" }))
        .rejects.toMatchObject({ name: "ForbiddenError", message: "unmask:rate-limit" });
      const rows = await db.select().from(auditLog).where(
        and(eq(auditLog.actorUserId, user.id), eq(auditLog.action, "field.unmask")),
      );
      expect(rows).toHaveLength(3);
    } finally {
      if (previous === undefined) delete process.env.UNMASK_RATE_LIMIT_PER_HOUR;
      else process.env.UNMASK_RATE_LIMIT_PER_HOUR = previous;
    }
  });

  it("fails closed on invalid limit configuration and accepts a valid configuration", async () => {
    const { id } = await userWithEmail();
    const { user } = await makeUser(db, ["approver"]);
    const previous = process.env.UNMASK_RATE_LIMIT_PER_HOUR;
    process.env.UNMASK_RATE_LIMIT_PER_HOUR = "0";

    try {
      await expect(unmask(db, user, userEntity, { entityId: id, field: "email", reason: "case work review" }))
        .rejects.toThrow("UNMASK_RATE_LIMIT_PER_HOUR must be a positive integer (see .env.example)");
      expect(await unmaskAuditRows(id)).toHaveLength(0);
    } finally {
      if (previous === undefined) delete process.env.UNMASK_RATE_LIMIT_PER_HOUR;
      else process.env.UNMASK_RATE_LIMIT_PER_HOUR = previous;
    }

    await expect(unmask(db, user, userEntity, { entityId: id, field: "email", reason: "case work review" }))
      .resolves.toBeTruthy();
    expect(await unmaskAuditRows(id)).toHaveLength(1);
  });
});
