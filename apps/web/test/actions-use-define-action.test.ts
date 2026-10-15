import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const appRoot = fileURLToPath(new URL("../", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return ["node_modules", ".next", "test", "e2e"].includes(name) ? [] : sourceFiles(path);
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

const USE_SERVER = /^\s*(?:\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use server["']/;

/** Returns "file: export" for every export in a "use server" file not built with defineAction. */
export function findUnguardedActions(files: { path: string; source: string }[]): string[] {
  const problems: string[] = [];
  for (const { path, source } of files) {
    if (!USE_SERVER.test(source)) continue;
    for (const line of source.split("\n")) {
      if (!/^\s*export\b/.test(line)) continue;
      const ok = /^\s*export\s+const\s+\w+\s*=\s*defineAction\(/.test(line);
      if (!ok) problems.push(`${path}: ${line.trim()}`);
    }
  }
  return problems;
}

describe("server actions", () => {
  it("every export in a 'use server' file is built with defineAction", () => {
    const files = sourceFiles(appRoot).map((p) => ({ path: relative(appRoot, p), source: readFileSync(p, "utf8") }));
    expect(files.some((f) => USE_SERVER.test(f.source))).toBe(true);
    expect(findUnguardedActions(files)).toEqual([]);
  });

  it("flags an action that skips defineAction (positive control)", () => {
    const bad = `"use server";\nexport async function deleteAll() {}\nexport const ok = defineAction("platform:access", "x", async () => {});\nexport default async function x() {}\n`;
    expect(findUnguardedActions([{ path: "bad.ts", source: bad }])).toEqual([
      "bad.ts: export async function deleteAll() {}",
      "bad.ts: export default async function x() {}",
    ]);
  });

  it("ignores files without the directive", () => {
    expect(findUnguardedActions([{ path: "lib.ts", source: "export function helper() {}" }])).toEqual([]);
  });
});
