import { createDb } from "@fit/db";
import { seedE2eFixtures } from "@fit/db/seed";
import { loadRootEnv } from "../../../packages/db/src/root-env.ts";

/** Adds the data only these tests use (e.g. `e2e-sandbox-flag`), so the normal seed stays clean. */
export default async function globalSetup(): Promise<void> {
  loadRootEnv();
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is not set (needed to add the e2e fixtures)");
  const db = createDb(url, { max: 1 });
  try {
    await seedE2eFixtures(db);
  } finally {
    await db.$client.end();
  }
}
