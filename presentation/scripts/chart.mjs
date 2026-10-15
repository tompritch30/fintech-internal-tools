// Build a horizontal bar chart SVG for each charts/*.json spec, in the theme's palette and font.
// Spec: { "output": "assets/charts/x.svg", "valuePrefix": "£", "valueSuffix": "",
//         "bars": [{ "label": "Option A", "value": 120, "highlight": true }, …] }
// A bar with "value": null is drawn as a dashed placeholder labelled "[TBD]" (or its "placeholder" text):
// never invent a number.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT } from "./lib.mjs";

const C = { ink: "#191919", muted: "#626870", rule: "#e5e5e5", accent: "#2200ff", accent2: "#317cff" };
const W = 1000;
const LABEL_MIN_W = 300;
const VALUE_W = 160;
const MIN_TRACK = 400;
const BAR_H = 96;
const GAP = 56;
export const CHART_FONT = 36;
const FONT = CHART_FONT;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

export function barChart(spec, fontBase64) {
  const bars = spec.bars ?? [];
  const known = bars.filter((b) => typeof b.value === "number");
  const max = Math.max(...known.map((b) => b.value), 0) || 1;
  const fmt = (b) => `${spec.valuePrefix ?? ""}${b.value.toLocaleString("en-GB")}${spec.valueSuffix ?? ""}`;
  // Reserve room for the longest value label (Inter semibold is about 0.65 em per character).
  // Label column fits the longest label, so labels never run into the bars.
  const LABEL_W = Math.max(LABEL_MIN_W, 32 + Math.max(0, ...bars.map((b) => String(b.label).length)) * FONT * 0.62);
  const valueW = Math.max(VALUE_W, ...known.map((b) => 24 + fmt(b).length * FONT * 0.65));
  // Long labels widen the chart (it scales to fit its box) rather than squeezing the bars.
  const width = Math.max(W, LABEL_W + MIN_TRACK + valueW);
  const track = width - LABEL_W - valueW;
  const H = bars.length * BAR_H + (bars.length - 1) * GAP;
  const rows = bars.map((b, i) => {
    const y = i * (BAR_H + GAP);
    const cy = y + BAR_H / 2;
    const label = `<text x="0" y="${cy}" dominant-baseline="middle" font-weight="600">${esc(b.label)}</text>`;
    if (typeof b.value !== "number") {
      const w = track * 0.6;
      return `${label}<rect x="${LABEL_W}" y="${y + 1.5}" width="${w}" height="${BAR_H - 3}" fill="none" stroke="${C.muted}" stroke-width="3" stroke-dasharray="12 10"/>
<text x="${LABEL_W + w + 24}" y="${cy}" dominant-baseline="middle" fill="${C.muted}">${esc(b.placeholder ?? "[TBD]")}</text>`;
    }
    const w = Math.max(4, (b.value / max) * track);
    const value = fmt(b);
    return `${label}<rect x="${LABEL_W}" y="${y}" width="${w}" height="${BAR_H}" fill="${b.highlight ? C.accent : C.muted}"/>
<text x="${LABEL_W + w + 24}" y="${cy}" dominant-baseline="middle" font-weight="600">${esc(value)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${H}" width="${width}" height="${H}" role="img" aria-label="${esc(spec.alt ?? "Bar chart")}">
<style>@font-face{font-family:Inter;src:url(data:font/woff2;base64,${fontBase64}) format("woff2");font-weight:100 900}
text{font-family:Inter,sans-serif;font-size:${FONT}px;fill:${C.ink}}</style>
${rows.join("\n")}
</svg>
`;
}

export const fontBase64 = async () =>
  (await readFile(join(ROOT, "assets/fonts/inter-latin-wght-normal.woff2"))).toString("base64");

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const font = await fontBase64();
  const dir = join(ROOT, "charts");
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
    const spec = JSON.parse(await readFile(join(dir, file), "utf8"));
    const out = join(ROOT, spec.output);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, barChart(spec, font));
    console.log(`charts/${file} -> ${spec.output}`);
  }
}
