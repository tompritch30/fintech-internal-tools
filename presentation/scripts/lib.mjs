import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Marp } from "@marp-team/marp-core";
import { chromium } from "playwright";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const THEME = join(ROOT, "themes", "consultancy.css");
export const DIST = join(ROOT, "dist");

// Slide size is fixed by the theme; screenshots and checks use the same pixels.
export const WIDTH = 1920;
export const HEIGHT = 1080;

/** Point Marp CLI at Playwright's Chromium when no browser is configured. */
export function useBundledChromium() {
  if (process.env.CHROME_PATH) return;
  const path = chromium.executablePath();
  if (existsSync(path)) process.env.CHROME_PATH = path;
}

/** Launch Playwright's Chromium, falling back to an installed Chrome. */
export async function launchBrowser() {
  try {
    return await chromium.launch();
  } catch (err) {
    try {
      return await chromium.launch({ channel: "chrome" });
    } catch {
      throw new Error(
        `No browser found. Run \`pnpm --filter @fit/presentation setup:browser\`.\n${err.message}`,
      );
    }
  }
}

/**
 * Render a deck with Marp Core (the engine Marp CLI uses) into a page that lays every slide
 * out at 1920x1080, stacked. Relative URLs (fonts, images) resolve against presentation/.
 */
export async function renderDeckPage(mdPath) {
  const marp = new Marp({ html: true, inlineSVG: true });
  marp.themeSet.default = marp.themeSet.add(await readFile(THEME, "utf8"));
  const { html, css, comments } = marp.render(await readFile(mdPath, "utf8"));
  const page = `<!doctype html><html><head><meta charset="utf-8">
<base href="${pathToFileURL(ROOT + "/").href}">
<style>${css}</style>
<style>html,body{margin:0;padding:0;background:#fff}
svg[data-marpit-svg]{display:block;width:${WIDTH}px;height:${HEIGHT}px}</style>
</head><body>${html}</body></html>`;
  return { page, notes: comments.map((c) => c.join("\n")) };
}
