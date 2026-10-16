// Proves the checker catches each rule: every fixture slide declares the failure it must
// produce (`<!-- expect: code -->`), and control slides (`expect: pass`) must pass.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkDeck } from "./check.mjs";
import { DIST, ROOT, launchBrowser } from "./lib.mjs";
import { barChart, chartFonts } from "./chart.mjs";

const fixture = join(ROOT, "test/fixtures/violations.md");
// Each fixture slide names the failure it must produce, plus any side effects it may also cause
// (`<!-- also: a b -->`), e.g. an overflowing block also touching the footer.
const chunks = (await readFile(fixture, "utf8")).split("<!-- expect: ").slice(1);
const expected = chunks.map((c) => c.match(/^([\w-]+)/)[1]);
const allowed = chunks.map((c) => (c.match(/<!-- also: ([\w\s-]+?) -->/)?.[1] ?? "").split(/\s+/).filter(Boolean));
const { slides } = await checkDeck(fixture, { outDir: join(DIST, "check", "selftest") });

let ok = slides.length === expected.length;
if (!ok) console.log(`✗ fixture has ${slides.length} slides but ${expected.length} expectations`);
for (const [i, want] of expected.entries()) {
  const codes = (slides[i]?.fail ?? []).map(([c]) => c);
  const pass = want === "pass" ? codes.length === 0 : codes.includes(want) && codes.every((c) => c === want || allowed[i].includes(c));
  ok &&= pass;
  console.log(`${pass ? "✓" : "✗"} slide ${i + 1}: expect ${want}, got ${codes.length ? codes.join(", ") : "pass"}`);
}
// ECharts output: every label inside the SVG, no label touching a bar, and no chart without measured values.
const fonts = await chartFonts();
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  const specs = [
    { valuePrefix: "£", bars: [{ label: "Long value", value: 123456789 }, { label: "Short", value: 1 }] },
    { bars: [{ label: "WWWWWWWWWWWWWWWWWWWW", value: 10 }, { label: "Short", value: 9, highlight: true }] },
    { valueSuffix: " per user per month", bars: [{ label: "Priced", value: 42 }, { label: "Other", value: 7 }] },
  ];
  for (const spec of specs) {
    await page.setContent(barChart(spec, fonts));
    await page.evaluate(() => document.fonts.ready);
    const bad = await page.evaluate(() => {
      const svg = document.querySelector("svg");
      const W = +svg.getAttribute("width"), H = +svg.getAttribute("height");
      // ECharts positions text with transforms, so compare on-screen boxes, not local getBBox().
      const o = svg.getBoundingClientRect();
      const rect = (el) => { const r = el.getBoundingClientRect(); return { x: r.x - o.x, y: r.y - o.y, width: r.width, height: r.height }; };
      const bars = [...svg.querySelectorAll("path")].map(rect).filter((b) => b.width > 0 && b.height > 40);
      const hit = (a, b) => a.x < b.x + b.width + 8 && b.x < a.x + a.width + 8 && a.y < b.y + b.height && b.y < a.y + a.height;
      return [...svg.querySelectorAll("text")].filter((t) => {
        const b = rect(t);
        return b.x < 0 || b.y < 0 || b.x + b.width > W || b.y + b.height > H || bars.some((r) => hit(b, r));
      }).map((t) => t.textContent);
    });
    const pass = bad.length === 0;
    ok &&= pass;
    console.log(`${pass ? "✓" : "✗"} chart "${spec.bars[0].label}": labels inside the chart and clear of bars${pass ? "" : ` (${bad.join(", ")})`}`);
  }
  let threw = false;
  try { barChart({ bars: [{ label: "Unknown", value: null }] }, fonts); } catch { threw = true; }
  ok &&= threw;
  console.log(`${threw ? "✓" : "✗"} chart: a bar without a measured value is refused`);
  let threwAccent = false;
  try { barChart({ bars: [{ label: "A", value: 1, highlight: true }, { label: "B", value: 2, highlight: true }] }, fonts); } catch { threwAccent = true; }
  ok &&= threwAccent;
  console.log(`${threwAccent ? "✓" : "✗"} chart: more than one highlighted bar is refused`);
} finally {
  await browser.close();
}
const altSvg = barChart({ alt: "C $710K to $1.4M", bars: [{ label: "A", value: 1 }] }, fonts);
const altOk = altSvg.includes('aria-label="C $710K to $1.4M"');
ok &&= altOk;
console.log(`${altOk ? "✓" : "✗"} chart: "$1" in alt text is kept, not read as a capture group`);

console.log(ok ? "\nselftest passed" : "\nselftest FAILED");
process.exit(ok ? 0 : 1);
