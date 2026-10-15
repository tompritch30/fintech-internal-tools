// Proves the checker catches each rule: every fixture slide declares the failure it must
// produce (`<!-- expect: code -->`), and control slides (`expect: pass`) must pass.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkDeck } from "./check.mjs";
import { DIST, ROOT } from "./lib.mjs";

const fixture = join(ROOT, "test/fixtures/violations.md");
const expected = [...(await readFile(fixture, "utf8")).matchAll(/<!-- expect: ([\w-]+) -->/g)].map((m) => m[1]);
const { slides } = await checkDeck(fixture, { outDir: join(DIST, "check", "selftest") });

let ok = slides.length === expected.length;
if (!ok) console.log(`✗ fixture has ${slides.length} slides but ${expected.length} expectations`);
for (const [i, want] of expected.entries()) {
  const codes = (slides[i]?.fail ?? []).map(([c]) => c);
  const pass = want === "pass" ? codes.length === 0 : codes.includes(want) && codes.every((c) => c === want);
  ok &&= pass;
  console.log(`${pass ? "✓" : "✗"} slide ${i + 1}: expect ${want}, got ${codes.length ? codes.join(", ") : "pass"}`);
}
console.log(ok ? "\nselftest passed" : "\nselftest FAILED");
process.exit(ok ? 0 : 1);
