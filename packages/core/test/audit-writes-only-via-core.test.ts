import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));

// The only files allowed to write to audit_log.
const ALLOWED = ["packages/core/src/audit/with-audit.ts", "packages/db/src/seed.ts"];
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "migrations", "test", "e2e", "test-results"]);
const WRITE_PATTERNS = [/\.insert\(\s*auditLog\b/, /insert\s+into\s+"?audit_log"?/i];

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return SKIP_DIRS.has(name) ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

export function findAuditWriters(files: { path: string; source: string }[]): string[] {
  return files.filter((f) => !ALLOWED.includes(f.path) && WRITE_PATTERNS.some((p) => p.test(f.source))).map((f) => f.path);
}

describe("only packages/core writes to audit_log", () => {
  it("finds no audit_log writes outside the allowed files", () => {
    const files = ["apps", "packages"].flatMap((d) => sourceFiles(join(repoRoot, d)));
    const writers = findAuditWriters(files.map((p) => ({ path: relative(repoRoot, p), source: readFileSync(p, "utf8") })));
    expect(writers).toEqual([]);
  });

  it("flags a direct audit_log insert in app code (positive control)", () => {
    expect(
      findAuditWriters([
        { path: "apps/web/app/x/actions.ts", source: "await db.insert(auditLog).values({})" },
        { path: "packages/core/src/audit/with-audit.ts", source: "await executor.insert(auditLog).values({})" },
      ]),
    ).toEqual(["apps/web/app/x/actions.ts"]);
  });
});
