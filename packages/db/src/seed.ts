// Dummy data only. Subjects match the user ids in infra/keycloak/internal-tools-realm.json.
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "./index.ts";
import { auditLog, flags, flagValues, kycCases, kycDocuments, payments, roles, userRoles, users } from "./schema.ts";

export const SEED_ROLES = [
  { name: "analyst", description: "Works the queues; can create requests" },
  { name: "approver", description: "Approves or rejects requests" },
  { name: "admin", description: "Platform admin; can read the audit log" },
] as const;

export const SEED_USERS = [
  { subject: "11111111-1111-4111-8111-111111111111", username: "analyst", displayName: "Avery Analyst", roles: ["analyst"] },
  { subject: "22222222-2222-4222-8222-222222222222", username: "approver", displayName: "Parker Approver", roles: ["approver"] },
  { subject: "33333333-3333-4333-8333-333333333333", username: "admin", displayName: "Morgan Admin", roles: ["admin"] },
  { subject: "44444444-4444-4444-8444-444444444444", username: "norole", displayName: "Nico Norole", roles: [] },
  // Holds both roles, so the E2E test can show a requester being blocked from approving their own refund.
  { subject: "55555555-5555-4555-8555-555555555555", username: "senior", displayName: "Sam Senior", roles: ["analyst", "approver"] },
] as const;

const FIRST_NAMES = ["Olivia", "Harry", "Amelia", "Jack", "Isla", "George", "Ava", "Noah", "Mia", "Leo", "Freya", "Arthur", "Poppy", "Oscar", "Sophie", "Charlie", "Grace", "Alfie", "Evie", "Theo"];
const LAST_NAMES = ["Patel", "Thompson", "Hughes", "Okafor", "Walsh", "Clarke", "Nowak", "Bennett", "Khan", "Murphy", "Evans", "Fraser", "Lewis", "Ahmed", "Reid", "Turner", "Shah", "Doyle", "Price", "Morgan"];
const MERCHANTS = ["Northwind Rail", "Bramble & Co Homeware", "Lumen Electronics", "Harbour Street Cafe", "Peak Outdoor Gear", "Cobalt Mobile", "Willow Books", "Fenwick Travel", "Oakline Furniture", "Brightside Gym"];
const BRANDS = ["Visa", "Mastercard", "Amex"] as const;

/** Deterministic PRNG (mulberry32) so the seed gives the same dummy payments every time. */
function prng(seedValue: number): () => number {
  let a = seedValue;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 40 fake card payments. Cards are brand + last four digits only; no card number exists anywhere. */
export function seedPayments(count = 40): (typeof payments.$inferInsert)[] {
  const rand = prng(20261015);
  const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)] as T;
  const anchor = Date.UTC(2026, 9, 14, 9, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const first = pick(FIRST_NAMES);
    const last = pick(LAST_NAMES);
    // Mostly everyday amounts, with every fourth payment large enough to need approval to refund.
    const amountPence = i % 4 === 0 ? 30_000 + Math.floor(rand() * 150_000) : 499 + Math.floor(rand() * 24_000);
    return {
      reference: `PAY-${100001 + i}`,
      customerName: `${first} ${last}`,
      customerEmail: `${first}.${last}${i}@example.test`.toLowerCase(),
      merchant: pick(MERCHANTS),
      cardBrand: pick(BRANDS),
      cardLast4: String(Math.floor(rand() * 10_000)).padStart(4, "0"),
      amountPence,
      capturedAt: new Date(anchor - i * 31 * 3_600_000 - Math.floor(rand() * 3_600_000)),
    };
  });
}

const STREETS = ["Example Lane", "Sample Road", "Placeholder Street", "Fictional Avenue", "Testing Close", "Demo Crescent"];
const TOWNS = ["Testford", "Mockbury", "Sampleton", "Dummyhampton", "Fakely"];
const NATIONALITIES = ["GB", "IE", "FR", "DE", "PL", "IN", "NG", "ES"];

export interface SeedKycCase {
  kase: typeof kycCases.$inferInsert & { reference: string };
  documents: Omit<typeof kycDocuments.$inferInsert, "caseId">[];
}

/**
 * 30 synthetic KYC cases, all open and unclaimed. Invented names, ID numbers (TST- prefix),
 * addresses (fictional streets, ZZ postcodes) and documents. Every fifth case is a PEP, every
 * seventh a sanctions hit, and both are high-risk; a few more are high-risk on rating alone.
 */
export function seedKycCases(count = 30): SeedKycCase[] {
  const rand = prng(20261016);
  const pick = <T>(items: readonly T[]) => items[Math.floor(rand() * items.length)] as T;
  const anchor = Date.UTC(2026, 9, 15, 8, 0, 0);
  return Array.from({ length: count }, (_, i) => {
    const name = `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`;
    const pep = i % 5 === 3;
    const sanctionsHit = i % 7 === 5;
    const riskRating = pep || sanctionsHit || i % 9 === 8 ? "high" : i % 3 === 0 ? "medium" : "low";
    const year = 1950 + Math.floor(rand() * 55);
    const month = String(1 + Math.floor(rand() * 12)).padStart(2, "0");
    const day = String(1 + Math.floor(rand() * 28)).padStart(2, "0");
    const dateOfBirth = `${year}-${month}-${day}`;
    const idNumber = `TST-${String(Math.floor(rand() * 1_000_000)).padStart(6, "0")}`;
    const address = `${1 + Math.floor(rand() * 199)} ${pick(STREETS)}, ${pick(TOWNS)}, ZZ${1 + (i % 9)} ${1 + (i % 8)}TT`;
    const idKind = i % 2 === 0 ? "passport" : "driving_licence";
    const banner = "SYNTHETIC TEST DOCUMENT - not a real identity document";
    return {
      kase: {
        reference: `KYC-${200001 + i}`,
        applicantName: name,
        dateOfBirth,
        idNumber,
        address,
        nationality: pick(NATIONALITIES),
        riskRating,
        sanctionsHit,
        pep,
        openedAt: new Date(anchor - i * 5 * 3_600_000),
      },
      documents: [
        {
          kind: idKind,
          fileName: `${idKind}.pdf`,
          content: `${banner}\nType: ${idKind.replace("_", " ")}\nName: ${name}\nNumber: ${idNumber}\nDate of birth: ${dateOfBirth}`,
        },
        {
          kind: "utility_bill",
          fileName: "utility_bill.pdf",
          content: `${banner}\nType: utility bill\nName: ${name}\nAddress: ${address}`,
        },
      ],
    };
  });
}

type SeedValue = { enabled: boolean; rolloutPercentage: number };
const on = (rolloutPercentage: number): SeedValue => ({ enabled: true, rolloutPercentage });
const off = (rolloutPercentage = 0): SeedValue => ({ enabled: false, rolloutPercentage });

/** Fake feature flags with a value in every environment. Keys and descriptions are made up. */
export const SEED_FLAGS: readonly { key: string; description: string; dev: SeedValue; staging: SeedValue; prod: SeedValue }[] = [
  { key: "new-checkout-flow", description: "Single-page checkout with saved cards", dev: on(100), staging: on(50), prod: off() },
  { key: "instant-payouts", description: "Pay merchants out within minutes instead of next day", dev: on(100), staging: on(100), prod: on(10) },
  { key: "dispute-auto-triage", description: "Route new chargebacks to a queue by reason code", dev: on(100), staging: off(), prod: off() },
  { key: "statement-pdf-v2", description: "New PDF layout for monthly statements", dev: on(100), staging: on(100), prod: on(100) },
  { key: "fraud-score-shadow", description: "Score payments with the new fraud model without acting on it", dev: on(100), staging: on(25), prod: on(5) },
  { key: "merchant-dashboard-beta", description: "Beta merchant dashboard with live charts", dev: on(50), staging: off(), prod: off() },
  { key: "card-freeze-button", description: "Let cardholders freeze a card from the app", dev: on(100), staging: on(100), prod: off() },
  { key: "e2e-sandbox-flag", description: "Used by the Playwright tests; changes freely", dev: off(), staging: off(), prod: off() },
];

export async function seed(db: Db): Promise<void> {
  await db.transaction(async (tx) => {
    await tx.insert(roles).values([...SEED_ROLES]).onConflictDoNothing();

    for (const u of SEED_USERS) {
      const [row] = await tx
        .insert(users)
        .values({
          subject: u.subject,
          username: u.username,
          email: `${u.username}@example.test`,
          displayName: u.displayName,
        })
        .onConflictDoUpdate({
          target: users.subject,
          set: { username: u.username, displayName: u.displayName },
        })
        .returning({ id: users.id });
      if (!row) throw new Error(`seed: could not upsert ${u.username}`);
      if (u.roles.length > 0) {
        await tx
          .insert(userRoles)
          .values(u.roles.map((roleName) => ({ userId: row.id, roleName })))
          .onConflictDoNothing();
      }
    }

    // Payments are inserted once; refunds made later only change refunded_pence.
    await tx.insert(payments).values(seedPayments()).onConflictDoNothing({ target: payments.reference });

    // KYC cases are inserted once (documents with them); not audited: seeding is setup, not a business action.
    for (const { kase, documents } of seedKycCases()) {
      const [inserted] = await tx.insert(kycCases).values(kase).onConflictDoNothing({ target: kycCases.reference }).returning({ id: kycCases.id });
      if (inserted) await tx.insert(kycDocuments).values(documents.map((d) => ({ ...d, caseId: inserted.id })));
    }

    // Flags and their per-environment values are inserted once; later changes go through the app.
    for (const f of SEED_FLAGS) {
      await tx.insert(flags).values({ key: f.key, description: f.description }).onConflictDoNothing({ target: flags.key });
      const [flag] = await tx.select({ id: flags.id }).from(flags).where(eq(flags.key, f.key));
      if (!flag) throw new Error(`seed: could not insert flag ${f.key}`);
      await tx
        .insert(flagValues)
        .values((["dev", "staging", "prod"] as const).map((environment) => ({ flagId: flag.id, environment, ...f[environment] })))
        .onConflictDoNothing();
    }

    // audit_log is append-only, so sample rows are inserted once and never replaced.
    const existing = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(eq(auditLog.action, "seed.sample"))
      .limit(1);
    if (existing.length === 0) {
      const [admin] = await tx.select().from(users).where(eq(users.username, "admin"));
      await tx.insert(auditLog).values([
        {
          actorUserId: admin?.id,
          actorSubject: admin?.subject,
          action: "seed.sample",
          entityType: "platform",
          entityId: "seed",
          reason: "Sample row written by the seed script (dummy data)",
          after: { note: "Demo data loaded" },
        },
        {
          actorUserId: admin?.id,
          actorSubject: admin?.subject,
          action: "demo.note_added",
          entityType: "demo_record",
          entityId: "DEMO-1",
          reason: "Initial note on the demo record (dummy data)",
          after: { note: "Customer called about a duplicate charge." },
        },
      ]);
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is not set");
  const db = createDb(url, { max: 1 });
  try {
    await seed(db);
    console.log("Seed complete.");
  } finally {
    await db.$client.end();
  }
}
