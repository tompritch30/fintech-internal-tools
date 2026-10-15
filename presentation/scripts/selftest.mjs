// Proves the checker catches each rule: every fixture slide declares the failure it must
// produce (`<!-- expect: code -->`), and control slides (`expect: pass`) must pass.
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { checkDeck } from "./check.mjs";
import { DIST, ROOT, launchBrowser } from "./lib.mjs";
import { barChart, fontBase64 } from "./chart.mjs";

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
// Chart labels must stay inside the SVG, however long the value.
const svg = barChart({ valuePrefix: "£", bars: [{ label: "Long value", value: 123456789 }, { label: "Short", value: 1 }] }, await fontBase64());
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.setContent(svg);
  await page.evaluate(() => document.fonts.ready);
  const clipped = await page.evaluate(() => {
    const vb = document.querySelector("svg").viewBox.baseVal;
    return [...document.querySelectorAll("text")].filter((t) => { const b = t.getBBox(); return b.x + b.width > vb.width || b.x < 0; }).map((t) => t.textContent);
  });
  const pass = clipped.length === 0;
  ok &&= pass;
  console.log(`${pass ? "✓" : "✗"} chart: value labels fit inside the chart${pass ? "" : ` (clipped: ${clipped.join(", ")})`}`);

  const huge = barChart({ valueSuffix: " per user per month, before discounts and VAT", bars: [{ label: "Priced", value: 42 }, { label: "Unknown", value: null }] }, await fontBase64());
  await page.setContent(huge);
  const tooNarrow = await page.evaluate(() => [...document.querySelectorAll("rect")].filter((r) => r.width.baseVal.value < 100).length);
  const barsOk = tooNarrow === 0;
  ok &&= barsOk;
  console.log(`${barsOk ? "✓" : "✗"} chart: long value labels keep every bar visible${barsOk ? "" : ` (${tooNarrow} bars under 100px)`}`);

  // Wide-glyph labels must not run into their bars; long placeholders must stay inside the chart.
  const wide = barChart({ bars: [{ label: "WWWWWWWWWWWWWWWWWWWW", value: 10 }, { label: "Unknown", value: null, placeholder: "[not measured yet, waiting on billing export]" }] }, await fontBase64());
  await page.setContent(wide);
  await page.evaluate(() => document.fonts.ready);
  const wideBad = await page.evaluate(() => {
    const vb = document.querySelector("svg").viewBox.baseVal;
    const barX = document.querySelector("rect").x.baseVal.value;
    const texts = [...document.querySelectorAll("text")];
    const overlap = texts.filter((t) => t.getAttribute("x") === "0" && t.getBBox().x + t.getBBox().width > barX);
    const clipped = texts.filter((t) => t.getBBox().x + t.getBBox().width > vb.width);
    return [...overlap, ...clipped].map((t) => t.textContent);
  });
  const wideOk = wideBad.length === 0;
  ok &&= wideOk;
  console.log(`${wideOk ? "✓" : "✗"} chart: wide labels clear the bars and long placeholders fit${wideOk ? "" : ` (${wideBad.join(", ")})`}`);
} finally {
  await browser.close();
}
console.log(ok ? "\nselftest passed" : "\nselftest FAILED");
process.exit(ok ? 0 : 1);
