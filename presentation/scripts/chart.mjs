// Build a horizontal bar chart SVG for each charts/*.json spec with Apache ECharts (server-side SVG).
// Spec: { "output": "assets/charts/x.svg", "title": "…", "unit": "US$ per year", "valuePrefix": "$",
//         "bars": [{ "label": "Option A", "value": 120, "highlight": true }, …] }
// A bar may also give "from" (solid to "from", then a thinner span to "value" with end caps), "text" (its value label),
// "parts": [{ "value": 60, "ink": true }, …] (a stacked bar; parts must sum to value),
// and "tag" (a small outlined label after the bar, e.g. "recommended"; labelsAbove charts only).
// Only chart measured or stated-estimate numbers. A bar without a numeric value is an error: put it in a table instead.
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";
import * as echarts from "echarts";
import { ROOT } from "./lib.mjs";

const C = { ink: "#191919", muted: "rgba(25,25,25,0.56)", grey: "#b9b7b4", accent: "#2200ff" };
export const CHART_FONT = 32;
// Matches the right-hand column of the theme, so the chart renders at 1:1 and text stays at CHART_FONT.
export const CHART_W = 960;
const BAR_H_DEFAULT = 88;
const GAP = 64;

// Generous per-glyph width estimate for Geist at CHART_FONT (wide capitals and digits count more).
const textW = (str) => [...String(str)].reduce((w, c) =>
  w + CHART_FONT * (/[WMmw@%]/.test(c) ? 0.95 : /[A-Z]/.test(c) ? 0.72 : /[0-9$£]/.test(c) ? 0.62 : /[\s.,:;'|!()[\]-]/.test(c) ? 0.32 : 0.58), 0);

export function barChart(spec, fonts = {}) {
  const bars = spec.bars ?? [];
  const BAR_H = spec.barHeight ?? BAR_H_DEFAULT;
  // Labels above the bars wrap as needed (see the labelsAbove branch below).
  const labelH = spec.labelsAbove ? (spec.labelLines ?? 1) * Math.round(CHART_FONT * 1.25) + 12 : 0;
  for (const b of bars) {
    if (typeof b.value !== "number") throw new Error(`chart bar "${b.label}" has no measured value; put it in a table`);
  }
  if (bars.filter((b) => b.highlight).length > 1) throw new Error("chart highlights more than one bar; blue is one accent per slide");
  for (const b of bars) {
    if (typeof b.from === "number" && !(b.from <= b.value)) throw new Error(`chart bar "${b.label}" range starts after it ends`);
    if (b.parts && b.parts.reduce((t, p) => t + p.value, 0) !== b.value) throw new Error(`chart bar "${b.label}" parts don't sum to its value`);
  }
  const fmt = (v) => `${spec.valuePrefix ?? ""}${v.toLocaleString("en-US")}${spec.valueSuffix ?? ""}`;
  const labelOf = (b) => b.text ?? fmt(b.value);
  const fill = (b, p) => (b.highlight ? C.accent : p?.ink ? C.ink : C.grey);
  const maxParts = Math.max(1, ...bars.map((b) => b.parts?.length ?? 1));
  const isRange = (b) => typeof b.from === "number";
  // One stacked series per part position; ranges draw as a custom I-beam so their caps sit on the ends.
  const stacked = Array.from({ length: maxParts }, (_, i) => ({
    type: "bar",
    stack: "s",
    barWidth: BAR_H,
    data: bars.map((b) => {
      if (isRange(b)) return i === 0 ? { value: b.from, itemStyle: { color: fill(b) } } : { value: 0 };
      const part = b.parts ? b.parts[i] : i === 0 ? { value: b.value } : null;
      return part ? { value: part.value, itemStyle: { color: fill(b, part) } } : { value: 0 };
    }),
    label: i === maxParts - 1 || maxParts === 1 ? undefined : { show: false },
  }));
  const ranges = {
    type: "custom",
    renderItem: (params, api) => {
      const b = bars[params.dataIndex];
      if (!isRange(b)) return null;
      const [x0, y] = api.coord([b.from, params.dataIndex]);
      const [x1] = api.coord([b.value, params.dataIndex]);
      const h = BAR_H, t = h * 0.4, cap = { stroke: C.ink, lineWidth: 3 };
      return { type: "group", children: [
        { type: "rect", shape: { x: x0, y: y - t / 2, width: Math.max(x1 - x0, 1), height: t }, style: { fill: fill(b) } },
        { type: "line", shape: { x1: x0, y1: y - h / 2, x2: x0, y2: y + h / 2 }, style: cap },
        { type: "line", shape: { x1: x1, y1: y - h / 2, x2: x1, y2: y + h / 2 }, style: cap },
      ] };
    },
    data: bars.map((b, i) => [b.value, i]),
  };
  const valueLabels = {
    type: "custom",
    renderItem: (params, api) => {
      const b = bars[params.dataIndex];
      const [x, y] = api.coord([b.value, params.dataIndex]);
      return { type: "text", x: x + 20, y, style: { text: labelOf(b), fontFamily: "Geist", fontSize: CHART_FONT, fill: C.ink, verticalAlign: "middle" } };
    },
    data: bars.map((b, i) => [b.value, i]),
  };
  // With labels above, each band is label + bar + gap and the bar sits at the band's centre,
  // so pull the grid up and down by half a band's slack to drop the empty space at the ends.
  const bandGap = spec.bandGap ?? 32;
  const slack = (labelH + bandGap) / 2;
  const gridTop = spec.labelsAbove ? Math.ceil(labelH + 12 - slack) : 20;
  const gridBottom = spec.labelsAbove ? Math.ceil(8 - slack) : 20;
  const height = spec.labelsAbove
    ? bars.length * (labelH + BAR_H + bandGap) + gridTop + gridBottom
    : bars.length * BAR_H + (bars.length - 1) * GAP + 40;
  const width = spec.width ?? CHART_W;
  const chart = echarts.init(null, null, { renderer: "svg", ssr: true, width, height: spec.height ?? height });
  chart.setOption({
    animation: false,
    textStyle: { fontFamily: "Geist", fontSize: CHART_FONT, color: C.ink },
    grid: { left: 0, right: 0, top: 20, bottom: 20, containLabel: false },
    xAxis: { type: "value", show: false, min: 0, max: Math.max(...bars.map((b) => b.value)) },
    yAxis: {
      type: "category",
      inverse: true,
      data: bars.map((b) => b.label),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { fontFamily: "Geist", fontSize: CHART_FONT, color: C.ink, align: "left", margin: 0 },
    },
    series: [...stacked, ranges, valueLabels],
  });
  // Leave room on the right for the longest value label.
  const longest = Math.max(...bars.map((b) => textW(labelOf(b))));
  // ECharts measures text without our web font, so reserve label room from our own estimate.
  const labelW = Math.ceil(Math.max(...bars.map((b) => textW(b.label)))) + 40;
  // Labels start at the chart's left edge, so they line up with the slide's left edge.
  chart.setOption({ yAxis: { axisLabel: { margin: labelW } }, grid: { left: spec.labelsAbove ? 0 : labelW, right: Math.ceil(40 + longest), top: gridTop, bottom: gridBottom } });
  // Labels above: draw every bar ourselves so each band is only as tall as its own label.
  if (spec.labelsAbove) {
    const lineH = Math.round(CHART_FONT * 1.25);
    const lines = bars.map((b) => Math.max(1, Math.ceil(textW(b.label) / (width - 80))));
    const gap = spec.bandGap ?? 32;
    const ys = [];
    let y = 0;
    for (const [i] of bars.entries()) { y += lines[i] * lineH + 12; ys.push(y + BAR_H / 2); y += BAR_H + gap; }
    // A tag is taller than a thin bar, so leave room for it below the last bar.
    const tagSpill = bars.at(-1)?.tag ? Math.max(0, (Math.round(CHART_FONT * 1.4) - BAR_H) / 2) + 2 : 0;
    const h = Math.ceil(y - gap + 4 + tagSpill);
    chart.dispose();
    const c2 = echarts.init(null, null, { renderer: "svg", ssr: true, width, height: h });
    const maxV = Math.max(...bars.map((b) => b.value));
    // Leave room on the right for the longest value label, so the biggest bar's value isn't clipped.
    // A bar's "tag" (e.g. "recommended") is a small outlined label after the bar, in ink, not the accent.
    const tagW = (b) => (b.tag ? textW(b.tag) + 32 : 0);
    const valueW = Math.max(0, ...bars.map((b) => (labelOf(b) ? textW(labelOf(b)) + 20 : 0) + (b.tag ? tagW(b) + 20 : 0)));
    const xs = (v) => (v / maxV) * (width - 40 - valueW);
    c2.setOption({
      animation: false,
      series: [{
        type: "custom",
        coordinateSystem: "none",
        renderItem: (params) => {
          const i = params.dataIndex, b = bars[i], yc = ys[i], top = yc - BAR_H / 2;
          const kids = [{ type: "text", x: 0, y: top - 12, style: { text: b.label, width: width - 80, overflow: "break", lineHeight: lineH, fontFamily: "Geist", fontSize: CHART_FONT, fill: C.ink, verticalAlign: "bottom" } }];
          const parts = isRange(b) ? [{ value: b.from }] : b.parts ?? [{ value: b.value }];
          let x = 0;
          for (const part of parts) { kids.push({ type: "rect", shape: { x, y: top, width: xs(part.value), height: BAR_H }, style: { fill: fill(b, part) } }); x += xs(part.value); }
          if (isRange(b)) {
            const x0 = xs(b.from), x1 = xs(b.value), t = BAR_H * 0.4, cap = { stroke: C.ink, lineWidth: 3 };
            kids.push({ type: "rect", shape: { x: x0, y: yc - t / 2, width: Math.max(x1 - x0, 1), height: t }, style: { fill: fill(b) } });
            kids.push({ type: "line", shape: { x1: x0, y1: top, x2: x0, y2: top + BAR_H }, style: cap });
            kids.push({ type: "line", shape: { x1: x1, y1: top, x2: x1, y2: top + BAR_H }, style: cap });
          }
          if (labelOf(b)) kids.push({ type: "text", x: x + 20, y: yc, style: { text: labelOf(b), fontFamily: "Geist", fontSize: CHART_FONT, fill: C.ink, verticalAlign: "middle" } });
          if (b.tag) {
            const end = Math.max(x, isRange(b) ? xs(b.value) : x) + 20 + (labelOf(b) ? textW(labelOf(b)) + 20 : 0);
            const th = Math.round(CHART_FONT * 1.4);
            kids.push({ type: "rect", shape: { x: end, y: yc - th / 2, width: tagW(b), height: th }, style: { fill: "none", stroke: C.ink, lineWidth: 2 } });
            kids.push({ type: "text", x: end + 16, y: yc, style: { text: b.tag, fontFamily: "Geist", fontSize: CHART_FONT, fill: C.ink, verticalAlign: "middle" } });
          }
          return { type: "group", children: kids };
        },
        data: bars.map((b, i) => [i]),
      }],
    });
    return finish(c2.renderToSVGString(), c2);
  }
  return finish(chart.renderToSVGString(), chart);

  function finish(rendered, instance) {
  let svg = rendered;
  instance.dispose();
  const faces = Object.entries(fonts)
    .map(([family, b64]) => `@font-face{font-family:"${family}";src:url(data:font/woff2;base64,${b64}) format("woff2")}`)
    .join("");
  // A function replacement, so "$1" in alt text ("$1.4M") isn't read as a capture group.
  const alt = String(spec.alt ?? "Bar chart").replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  svg = svg.replace(/<svg([^>]*)>/, (_, attrs) => `<svg${attrs} role="img" aria-label="${alt}"><style>${faces}</style>`);
  return svg;
  }
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
