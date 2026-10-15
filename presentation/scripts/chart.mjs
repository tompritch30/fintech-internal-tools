// Build a horizontal bar chart SVG for each charts/*.json spec with Apache ECharts (server-side SVG).
// Spec: { "output": "assets/charts/x.svg", "title": "…", "unit": "US$ per year", "valuePrefix": "$",
//         "bars": [{ "label": "Option A", "value": 120, "highlight": true }, …] }
// Only chart measured numbers. A bar without a numeric value is an error: put it in a table instead.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import * as echarts from "echarts";
import { ROOT } from "./lib.mjs";

const C = { ink: "#191919", muted: "rgba(25,25,25,0.56)", grey: "#b9b7b4", accent: "#2200ff" };
export const CHART_FONT = 32;
// Matches the right-hand column of the theme, so the chart renders at 1:1 and text stays at CHART_FONT.
export const CHART_W = 960;
const BAR_H = 88;
const GAP = 64;

// Generous per-glyph width estimate for Geist at CHART_FONT (wide capitals and digits count more).
const textW = (str) => [...String(str)].reduce((w, c) =>
  w + CHART_FONT * (/[WMmw@%]/.test(c) ? 0.95 : /[A-Z]/.test(c) ? 0.72 : /[0-9$£]/.test(c) ? 0.62 : /[\s.,:;'|!()[\]-]/.test(c) ? 0.32 : 0.58), 0);

export function barChart(spec, fonts = {}) {
  const bars = spec.bars ?? [];
  for (const b of bars) {
    if (typeof b.value !== "number") throw new Error(`chart bar "${b.label}" has no measured value; put it in a table`);
  }
  if (bars.filter((b) => b.highlight).length > 1) throw new Error("chart highlights more than one bar; blue is one accent per slide");
  const fmt = (v) => `${spec.valuePrefix ?? ""}${v.toLocaleString("en-US")}${spec.valueSuffix ?? ""}`;
  const height = bars.length * BAR_H + (bars.length - 1) * GAP + 40;
  const width = spec.width ?? CHART_W;
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width, height: spec.height ?? height });
  chart.setOption({
    animation: false,
    textStyle: { fontFamily: "Geist", fontSize: CHART_FONT, color: C.ink },
    grid: { left: 0, right: 0, top: 20, bottom: 20, containLabel: false },
    xAxis: { type: "value", show: false, max: (v) => v.max * 1.0 },
    yAxis: {
      type: "category",
      inverse: true,
      data: bars.map((b) => b.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontFamily: "Geist", fontSize: CHART_FONT, color: C.ink, align: "left", margin: 0 },
    },
    series: [{
      type: "bar",
      barWidth: BAR_H,
      data: bars.map((b) => ({ value: b.value, itemStyle: { color: b.highlight ? C.accent : C.grey } })),
      label: {
        show: true,
        position: "right",
        distance: 20,
        formatter: (p) => fmt(p.value),
        fontFamily: "Geist",
        fontSize: CHART_FONT,
        color: C.ink,
      },
    }],
  });
  // Leave room on the right for the longest value label.
  const longest = Math.max(...bars.map((b) => fmt(b.value).length));
  // ECharts measures text without our web font, so reserve label room from our own estimate.
  const labelW = Math.ceil(Math.max(...bars.map((b) => textW(b.label)))) + 40;
  // Labels start at the chart's left edge, so they line up with the slide's left edge.
  chart.setOption({ yAxis: { axisLabel: { margin: labelW } }, grid: { left: labelW, right: 40 + longest * CHART_FONT * 0.62 } });
  let svg = chart.renderToSVGString();
  chart.dispose();
  const faces = Object.entries(fonts)
    .map(([family, b64]) => `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${b64}) format("woff2")}`)
    .join("");
  svg = svg.replace(/<svg([^>]*)>/, `<svg$1 role="img" aria-label="${String(spec.alt ?? "Bar chart").replace(/"/g, "&quot;")}"><style>${faces}</style>`);
  return svg;
}

const font = async (file) => (await readFile(join(ROOT, "assets/fonts", file))).toString("base64");
export const chartFonts = async () => ({
  Geist: await font("geist-sans-latin-400-normal.woff2"),
});

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const fonts = await chartFonts();
  const dir = join(ROOT, "charts");
  for (const file of (await readdir(dir)).filter((f) => f.endsWith(".json"))) {
    const spec = JSON.parse(await readFile(join(dir, file), "utf8"));
    const out = join(ROOT, spec.output);
    await mkdir(dirname(out), { recursive: true });
    await writeFile(out, barChart(spec, fonts));
    console.log(`charts/${file} -> ${spec.output}`);
  }
}
