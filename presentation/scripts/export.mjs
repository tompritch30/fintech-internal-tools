// Export slides.md to dist/ as HTML, PDF and/or PowerPoint.
// Usage: node scripts/export.mjs [html] [pdf] [pptx]
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { marpCli } from "@marp-team/marp-cli";
import { DIST, ROOT, THEME, useBundledChromium } from "./lib.mjs";

const FORMATS = {
  html: ["--html"],
  pdf: ["--pdf", "--pdf-notes"],
  pptx: ["--pptx"],
};

const requested = process.argv.slice(2);
const formats = requested.length ? requested : Object.keys(FORMATS);
for (const f of formats) {
  if (!FORMATS[f]) throw new Error(`Unknown format "${f}". Use: ${Object.keys(FORMATS).join(", ")}`);
}

useBundledChromium();
await mkdir(DIST, { recursive: true });
// The HTML export references fonts and images relatively, so ship assets/ beside it.
if (formats.includes("html")) await cp(join(ROOT, "assets"), join(DIST, "assets"), { recursive: true });

for (const f of formats) {
  const out = join(DIST, `slides.${f}`);
  const code = await marpCli([
    join(ROOT, "slides.md"),
    "--no-config-file",
    "--theme", THEME,
    "--html",
    "--allow-local-files",
    ...FORMATS[f],
    "-o", out,
  ]);
  if (code !== 0) process.exit(code);
}
