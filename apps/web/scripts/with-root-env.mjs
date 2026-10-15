// Loads the repo-root .env (if present) into the environment, then runs the given command.
// Real environment variables win over .env values. Used by `pnpm dev` / `pnpm start`.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const envFile = fileURLToPath(new URL("../../../.env", import.meta.url));
if (existsSync(envFile)) {
  const before = { ...process.env };
  process.loadEnvFile(envFile);
  Object.assign(process.env, before);
}

const [command, ...args] = process.argv.slice(2);
const child = spawn(command, args, { stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 1)));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
