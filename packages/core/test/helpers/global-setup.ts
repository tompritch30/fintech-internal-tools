import { createDb } from "@fit/db";
import { runMigrations } from "@fit/db/migrate";
import { seed } from "@fit/db/seed";
import { TEST_DATABASE_OWNER_URL } from "./env.ts";

export default async function setup(): Promise<void> {
  await runMigrations(TEST_DATABASE_OWNER_URL);
  const db = createDb(TEST_DATABASE_OWNER_URL, { max: 1 });
  try {
    await seed(db);
  } finally {
    await db.$client.end();
  }
}
