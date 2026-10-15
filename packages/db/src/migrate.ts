import { fileURLToPath } from "node:url";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { createDb } from "./index.ts";
import { loadRootEnv } from "./root-env.ts";

export const migrationsFolder = fileURLToPath(new URL("../migrations", import.meta.url));

/** Runs all pending migrations. Must connect as the owner role (app_owner). */
export async function runMigrations(ownerUrl: string): Promise<void> {
  const db = createDb(ownerUrl, { max: 1 });
  try {
    await migrate(db, { migrationsFolder });
  } finally {
    await db.$client.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  loadRootEnv();
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is not set");
  await runMigrations(url);
  console.log("Migrations applied.");
}
