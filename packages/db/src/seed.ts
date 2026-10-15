// Dummy data only. Subjects match the user ids in infra/keycloak/internal-tools-realm.json.
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { createDb, type Db } from "./index.ts";
import { auditLog, roles, userRoles, users } from "./schema.ts";

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
] as const;

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
