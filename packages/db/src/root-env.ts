import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT_ENV = fileURLToPath(new URL("../../../.env", import.meta.url));

/** Loads the repo-root .env, if present, for the db scripts. Real environment variables win. */
export function loadRootEnv(file: string = ROOT_ENV): void {
  if (!existsSync(file)) return;
  const before = { ...process.env };
  process.loadEnvFile(file);
  Object.assign(process.env, before);
}
