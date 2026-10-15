import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { auditLog, users } from "@fit/db";
import { ForbiddenError, NotFoundError, ValidationError } from "../src/index.ts";
import { defineMaskedEntity, mask, unmask } from "../src/masking/masking.ts";
import { appDb, makeUser, uniqueId } from "./helpers/db.ts";

const db = appDb();

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
    const value = await unmask(db, approverUser, userEntity, { entityId: id, field: "email", reason: "case work" });
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

  it("writes a field.unmask audit row with the reason and never the value", async () => {
    const { id, email } = await userWithEmail();
    const { user: approverUser } = await makeUser(db, ["approver"]);
    await unmask(db, approverUser, userEntity, { entityId: id, field: "email", reason: "  case work  " });
    const rows = await unmaskAuditRows(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorUserId: approverUser.id,
      actorSubject: approverUser.subject,
      entityType: "user",
      entityId: id,
      reason: "case work",
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
      unmask(db, ghost, userEntity, { entityId: id, field: "email", reason: "case work" }),
    ).rejects.toThrow();
    expect(await unmaskAuditRows(id)).toHaveLength(0);
  });

  it("rejects unmask of a field without a policy", async () => {
    const { id } = await userWithEmail();
    const { user: approverUser } = await makeUser(db, ["approver"]);
    await expect(
      unmask(db, approverUser, userEntity, { entityId: id, field: "username", reason: "case work" }),
    ).rejects.toThrow(ValidationError);
    expect(await unmaskAuditRows(id)).toHaveLength(0);
  });

  it("writes no audit row when the record does not exist", async () => {
    const missing = "00000000-0000-4000-8000-000000000000";
    const { user: approverUser } = await makeUser(db, ["approver"]);
    await expect(
      unmask(db, approverUser, userEntity, { entityId: missing, field: "email", reason: "case work" }),
    ).rejects.toThrow(NotFoundError);
    expect(await unmaskAuditRows(missing)).toHaveLength(0);
  });
});
