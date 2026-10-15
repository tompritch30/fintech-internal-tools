// Render every slide at 1920x1080, screenshot it, and fail on rule breaks.
// Usage: node scripts/check.mjs [deck.md] [--out dir]
// Failures: title wraps / missing, text overflows the slide or its margins, more than three
// bullets, plus the other mechanical rules from .agents/skills/slides/SKILL.md.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DIST, HEIGHT, WIDTH, launchBrowser, renderDeckPage } from "./lib.mjs";

export const BANNED = [
  /\bleverag\w*/i,
  /\bseamless\w*/i,
  /\brobust\w*/i,
  /\bunlock\w*/i,
  /\bgame[\s-]?chang\w*/i,
];
export const LIMITS = { bullets: 3, bulletWords: 12, paragraphWords: 20, titleChars: 70, minFontPx: 24, visuals: 1 };

/** Runs in the page: measure each slide. Keep it self-contained (it is serialised). */
function measure(limits) {
  const words = (t) => t.trim().split(/\s+/).filter(Boolean).length;
  const ownText = (el) =>
    [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join("").trim();
  const lineCount = (el) => {
    const tops = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const lh = parseFloat(getComputedStyle(el).lineHeight) || parseFloat(getComputedStyle(el).fontSize);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const r = document.createRange();
      r.selectNodeContents(n);
      for (const rect of r.getClientRects()) {
        if (rect.width < 1) continue;
        if (!tops.some((t) => Math.abs(t - rect.top) < lh / 2)) tops.push(rect.top);
      }
    }
    return tops.length;
  };

  return [...document.querySelectorAll("svg[data-marpit-svg] > foreignObject > section")].map((s) => {
    const fail = [];
    const warn = [];
    const sr = s.getBoundingClientRect();
    const cs = getComputedStyle(s);
    const box = {
      left: sr.left + parseFloat(cs.paddingLeft),
      right: sr.right - parseFloat(cs.paddingRight),
      top: sr.top,
      bottom: sr.bottom - parseFloat(cs.paddingBottom),
    };
    const chrome = (el) => el.closest("header, footer");
    const all = [...s.querySelectorAll("*")].filter((el) => getComputedStyle(el).display !== "none");

    // Title
    const titles = s.querySelectorAll(":scope > h1");
    const h1 = titles[0];
    const title = h1 ? h1.textContent.trim() : "";
    if (!h1) fail.push(["missing-title", "no action title (# heading)"]);
    if (titles.length > 1) fail.push(["multiple-titles", `${titles.length} titles; one question per slide`]);
    if (h1) {
      const lines = lineCount(h1);
      if (lines > 1) fail.push(["title-wraps", `title wraps onto ${lines} lines`]);
      if (title.length > limits.titleChars) warn.push(`title is ${title.length} chars (aim for ≤${limits.titleChars})`);
    }

    // Overflow: anything outside the slide, content running into the margins/footer, clipped text.
    const overflow = new Set();
    if (s.scrollWidth > s.clientWidth + 1 || s.scrollHeight > s.clientHeight + 1) overflow.add("content larger than the slide");
    for (const el of all) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const tag = el.tagName.toLowerCase();
      if (r.right > sr.right + 1 || r.bottom > sr.bottom + 1 || r.left < sr.left - 1 || r.top < sr.top - 1) {
        overflow.add(`<${tag}> off the slide`);
      } else if (!chrome(el) && (r.bottom > box.bottom + 1 || r.right > box.right + 1 || r.left < box.left - 1)) {
        overflow.add(`<${tag}> runs into the margin or footer`);
      }
      const ov = getComputedStyle(el);
      if ((ov.overflowX !== "visible" && el.scrollWidth > el.clientWidth + 1) ||
          (ov.overflowY !== "visible" && el.scrollHeight > el.clientHeight + 1)) {
        overflow.add(`text clipped in <${tag}>${chrome(el) ? " (footer/header too long)" : ""}`);
      }
    }
    // Grid rows clip nothing visually, so also compare each content block with its own box.
    for (const el of s.querySelectorAll(":scope > :not(header):not(footer)")) {
      if (el.scrollHeight > el.clientHeight + 1 && getComputedStyle(el).display !== "inline") {
        const last = el.lastElementChild?.getBoundingClientRect();
        if (last && last.bottom > box.bottom + 1) overflow.add(`<${el.tagName.toLowerCase()}> content runs past the slide body`);
      }
    }
    for (const o of overflow) fail.push(["overflow", o]);

    // Bullets
    const lis = [...s.querySelectorAll("li")];
    if (lis.length > limits.bullets) fail.push(["too-many-bullets", `${lis.length} bullets (max ${limits.bullets})`]);
    for (const li of lis) {
      const n = words(li.textContent);
      if (n > limits.bulletWords) fail.push(["bullet-too-long", `bullet has ${n} words (max ${limits.bulletWords}): "${li.textContent.trim().slice(0, 40)}…"`]);
    }

    // Paragraphs
    for (const p of s.querySelectorAll(":scope > p, :scope > blockquote")) {
      if (p.querySelector("img")) continue;
      const n = words(p.textContent);
      if (n > limits.paragraphWords) fail.push(["paragraph", `text block of ${n} words; use ≤3 short bullets`]);
    }

    // One visual
    const visuals = s.querySelectorAll(":scope > p:has(> img), :scope > .visual, :scope > table, :scope > figure, :scope > svg, :scope > pre");
    if (visuals.length > limits.visuals) fail.push(["too-many-visuals", `${visuals.length} visuals (max ${limits.visuals})`]);
    if (visuals.length === 0) warn.push("no visual (chart, diagram, table or screenshot)");

    // Text size
    for (const el of all) {
      if (!ownText(el) && !(el === s)) continue;
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (ownText(el) && px < limits.minFontPx) {
        fail.push(["text-too-small", `<${el.tagName.toLowerCase()}> text is ${px}px (min ${limits.minFontPx}px)`]);
        break;
      }
    }

    // Numbers need a source line
    const footer = s.querySelector(":scope > footer");
    const footerText = footer ? footer.textContent.trim() : "";
    const body = [...s.children].filter((el) => !el.matches("header, footer")).map((el) => el.textContent).join(" ");
    const hasChart = [...s.querySelectorAll("img")].some((img) => /(^|\/)charts\//.test(img.getAttribute("src") ?? ""));
    if ((/\d/.test(body) || hasChart) && !/^sources?\b/i.test(footerText)) {
      fail.push(["number-without-source", "has numbers or a chart but no \"Source: …\" footer"]);
    }

    return { title, text: `${title} ${body}`, fail, warn };
  });
}

export async function checkDeck(mdPath, { outDir } = {}) {
  const input = resolve(mdPath);
  const out = outDir ?? join(DIST, "check", basename(input, ".md"));
  await rm(out, { recursive: true, force: true });
  await mkdir(out, { recursive: true });

  const { page: html, notes } = await renderDeckPage(input);
  const htmlPath = join(out, "render.html");
  await writeFile(htmlPath, html);

  const browser = await launchBrowser();
  try {
    const page = await browser.newPage({ viewport: { width: WIDTH, height: HEIGHT }, deviceScaleFactor: 1 });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const fontOk = await page.evaluate(() => document.fonts.check('36px "Inter"'));
    if (!fontOk) throw new Error("Inter did not load; check assets/fonts and the theme @font-face.");
    await page.waitForFunction(() => [...document.images].every((i) => i.complete));

    const slides = await page.evaluate(measure, LIMITS);
    const svgs = await page.$$("svg[data-marpit-svg]");
    for (const [i, s] of slides.entries()) {
      const spoken = notes[i] ?? "";
      for (const re of BANNED) {
        const m = `${s.text} ${spoken}`.match(re);
        if (m) s.fail.push(["banned-word", `banned word "${m[0]}"${s.text.match(re) ? "" : " (in speaker notes)"}`]);
      }
      if (!spoken.trim()) s.warn.push("no speaker notes (the reasoning goes there)");
      s.number = i + 1;
      s.screenshot = join(out, `slide-${String(i + 1).padStart(2, "0")}.png`);
      await svgs[i].screenshot({ path: s.screenshot });
      delete s.text;
    }
    await writeFile(join(out, "report.json"), JSON.stringify(slides, null, 2));
    return { slides, outDir: out };
  } finally {
    await browser.close();
  }
}

function printReport({ slides, outDir }) {
  console.log("Storyline (titles only, in order):");
  for (const s of slides) console.log(`  ${String(s.number).padStart(2)}. ${s.title || "(no title)"}`);
  console.log("");
  for (const s of slides) {
    console.log(`${s.fail.length ? "FAIL" : "PASS"}  slide ${s.number}: ${s.title || "(no title)"}`);
    for (const [code, msg] of s.fail) console.log(`      ✗ ${code}: ${msg}`);
    for (const msg of s.warn) console.log(`      ! ${msg}`);
  }
  const failed = slides.filter((s) => s.fail.length);
  console.log(`\n${slides.length - failed.length}/${slides.length} slides pass. Screenshots: ${outDir}`);
  return failed.length === 0;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--out");
  const outDir = outIdx >= 0 ? resolve(args[outIdx + 1]) : undefined;
  const deck = args.find((a, i) => !a.startsWith("--") && i !== outIdx + 1) ?? "slides.md";
  const ok = printReport(await checkDeck(deck, { outDir }));
  process.exit(ok ? 0 : 1);
}
