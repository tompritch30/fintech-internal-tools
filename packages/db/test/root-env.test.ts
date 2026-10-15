import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadRootEnv } from "../src/root-env.ts";

const KEY = "FIT_ROOT_ENV_TEST_URL";

function envFile(contents: string): string {
  const file = join(mkdtempSync(join(tmpdir(), "fit-env-")), ".env");
  writeFileSync(file, contents);
  return file;
}

describe("db scripts load the repo-root .env", () => {
  afterEach(() => {
    delete process.env[KEY];
  });

  it("sets a variable that is only in .env", () => {
    loadRootEnv(envFile(`${KEY}=from-file\n`));
    expect(process.env[KEY]).toBe("from-file");
  });

  it("keeps a variable already set in the environment", () => {
    process.env[KEY] = "from-env";
    loadRootEnv(envFile(`${KEY}=from-file\n`));
    expect(process.env[KEY]).toBe("from-env");
  });

  it("does nothing when there is no .env file", () => {
    expect(() => loadRootEnv(join(tmpdir(), "fit-env-missing", ".env"))).not.toThrow();
    expect(process.env[KEY]).toBeUndefined();
  });
});
