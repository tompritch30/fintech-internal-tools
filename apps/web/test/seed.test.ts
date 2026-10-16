import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { createDb, flags, users } from "@fit/db";
import { E2E_FLAGS, FLAG_SEEDED_REASON, PAYMENT_CAPTURED_REASON, SEED_FLAGS, seedE2eFixtures, seedKycCases } from "@fit/db/seed";
import { ownerDb } from "../../../packages/core/test/helpers/db.ts";
import { TEST_DATABASE_URL } from "../../../packages/core/test/helpers/env.ts";
import { myRecentActivity } from "../app/(platform)/dashboard.ts";

const db = createDb(TEST_DATABASE_URL);
afterAll(() => db.$client.end());
const owner = ownerDb();

describe("seed data looks like real use", () => {
  it("the seeded admin's recent activity has no demo or sample rows", async () => {
    const [admin] = await owner.select().from(users).where(eq(users.username, "admin"));
    const activity = await myRecentActivity(db, { id: admin!.id, permissions: new Set(["audit:read"]) as never });
    expect(activity.filter((a) => a.action === "seed.sample" || a.action.startsWith("demo."))).toEqual([]);
  });

  it("the normal seed has no Playwright-only flag; the e2e fixtures add it, once", async () => {
    expect(SEED_FLAGS.map((f) => f.key)).not.toContain("e2e-sandbox-flag");
    expect(SEED_FLAGS.length).toBeGreaterThan(0);
    await seedE2eFixtures(owner);
    await seedE2eFixtures(owner);
    for (const f of E2E_FLAGS) {
      expect(await owner.select().from(flags).where(eq(flags.key, f.key))).toHaveLength(1);
    }
    expect(E2E_FLAGS.map((f) => f.key)).toContain("e2e-sandbox-flag");
  });

  it("seeded payment captures give a realistic reason, not 'dummy data'", () => {
    expect(PAYMENT_CAPTURED_REASON).not.toMatch(/dummy|seed/i);
    expect(PAYMENT_CAPTURED_REASON.length).toBeGreaterThan(0);
  });

  it("seeded flags' starting values give a realistic reason, not 'dummy data'", () => {
    expect(FLAG_SEEDED_REASON).not.toMatch(/dummy|seed/i);
    expect(FLAG_SEEDED_REASON.length).toBeGreaterThan(0);
  });

  it("seeded KYC cases are numbered in the order they were opened", () => {
    const cases = seedKycCases().map((c) => c.kase);
    const byReference = [...cases].sort((a, b) => a.reference.localeCompare(b.reference));
    const byOpened = [...cases].sort((a, b) => a.openedAt!.getTime() - b.openedAt!.getTime());
    expect(byReference.map((c) => c.reference)).toEqual(byOpened.map((c) => c.reference));
  });
});
