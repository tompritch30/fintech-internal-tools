// Render every slide at 1920x1080, screenshot it, and fail on rule breaks.
// Usage: node scripts/check.mjs [deck.md] [--out dir]
// Failures: title wraps / missing, text overflows the slide or its margins, more than three
// bullets, plus the other mechanical rules from .agents/skills/slides/SKILL.md.
import { mkdir, rm, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DIST, HEIGHT, WIDTH, launchBrowser, renderDeckPage } from "./lib.mjs";
import { CHART_FONT } from "./chart.mjs";

export const BANNED = [
  /\bleverag\w*/i,
  /\bseamless\w*/i,
  /\brobust\w*/i,
  /\bunlock\w*/i,
  /\bgame[\s-]?chang\w*/i,
];
export const LIMITS = { bullets: 3, bulletWords: 12, paragraphWords: 20, titleChars: 70, minFontPx: 24, visuals: 1, chartFontPx: CHART_FONT, minGapPx: 24, maxEmptyPx: 120 };

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
    const isTitle = s.classList.contains("title");
    const all = [...s.querySelectorAll("*")].filter((el) => el.checkVisibility());

    // Title
    const titles = s.querySelectorAll(":scope > h1");
    const h1 = titles[0];
    const title = h1 ? h1.textContent.trim() : "";
    if (!h1) fail.push(["missing-title", "no action title (# heading)"]);
    if (titles.length > 1) fail.push(["multiple-titles", `${titles.length} titles; one question per slide`]);
    if (h1) {
      const lines = lineCount(h1);
      if (lines > 1 && !isTitle) fail.push(["title-wraps", `title wraps onto ${lines} lines`]);
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
    const visuals = s.querySelectorAll(":scope > p > img, :scope > .visual, :scope > table, :scope > figure, :scope > svg, :scope > pre");
    if (visuals.length > limits.visuals) fail.push(["too-many-visuals", `${visuals.length} visuals (max ${limits.visuals})`]);
    if (visuals.length === 0 && !isTitle) warn.push("no visual (chart, diagram, table or screenshot)");

    for (const img of s.querySelectorAll("img")) {
      if (!img.naturalWidth) fail.push(["missing-image", `image did not load: ${img.getAttribute("src")}`]);
    }

    // A drawing shown at a different shape from its file letterboxes, so its frame and corner marks float.
    for (const img of s.querySelectorAll("img")) {
      if (!img.naturalWidth || getComputedStyle(img).objectFit === "contain" || chrome(img)) continue;
      const r = img.getBoundingClientRect();
      const drift = Math.abs(r.width / r.height - img.naturalWidth / img.naturalHeight) / (img.naturalWidth / img.naturalHeight);
      if (drift > 0.01) fail.push(["image-aspect", `${img.getAttribute("src")} shown at ${Math.round(r.width)}×${Math.round(r.height)} but drawn at ${img.naturalWidth}×${img.naturalHeight}; match its shape`]);
    }

    // Chart text is inside the SVG, so scale the chart's font by how much the image is shrunk.
    for (const img of s.querySelectorAll("img")) {
      if (!/(^|\/)charts\//.test(img.getAttribute("src") ?? "") || !img.naturalWidth) continue;
      const box = img.getBoundingClientRect();
      // object-fit: contain shrinks the SVG to fit the tighter of width and height.
      const px = Math.min(box.width / img.naturalWidth, box.height / img.naturalHeight) * limits.chartFontPx;
      if (px < limits.minFontPx) fail.push(["chart-text-too-small", `chart labels render at ${px.toFixed(1)}px (min ${limits.minFontPx}px); give the chart more width or fewer bullets`]);
    }

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
    if ((/\d/.test(body) || hasChart) && !isTitle && !/^sources?\b/i.test(footerText)) {
      fail.push(["number-without-source", "has numbers or a chart but no \"Source: …\" footer"]);
    }

    // Spacing: no two blocks (kicker, title, bullets, visual, logo, source line) touch or overlap.
    const blocks = [...s.children]
      .filter((el) => getComputedStyle(el).display !== "none" && el.getBoundingClientRect().width > 0)
      .map((el) => ({ el, r: el.getBoundingClientRect() }));
    const name = (el) => el.tagName.toLowerCase() + (el.className ? `.${String(el.className).split(" ")[0]}` : "");
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        const a = blocks[i].r, b = blocks[j].r;
        const gapX = Math.max(b.left - a.right, a.left - b.right);
        const gapY = Math.max(b.top - a.bottom, a.top - b.bottom);
        if (Math.max(gapX, gapY) < limits.minGapPx) {
          fail.push(["elements-touch", `<${name(blocks[i].el)}> and <${name(blocks[j].el)}> are ${Math.max(gapX, gapY).toFixed(0)}px apart (min ${limits.minGapPx}px)`]);
        }
      }
    }

    if (!isTitle) {
      // Slide master: label, title, content and logo share one left edge.
      const edge = box.left;
      for (const { el, r } of blocks) {
        if (el.matches("footer") || getComputedStyle(el).gridColumnStart === "2") continue;
        if (Math.abs(r.left - edge) > 1) fail.push(["off-left-edge", `<${name(el)}> starts at ${Math.round(r.left)}px, not the ${Math.round(edge)}px left edge`]);
      }
      // One spacing step: label → title equals title → content.
      const label = s.querySelector(":scope > h6");
      const content = blocks.filter(({ el }) => !el.matches("h1, h6, header, footer"));
      if (label && h1 && content.length) {
        const g1 = h1.getBoundingClientRect().top - label.getBoundingClientRect().bottom;
        const g2 = Math.min(...content.map(({ r }) => r.top)) - h1.getBoundingClientRect().bottom;
        if (Math.abs(g1 - g2) > 2) fail.push(["uneven-gaps", `label→title gap ${Math.round(g1)}px but title→content gap ${Math.round(g2)}px`]);
      }
      // Use the space: content reaches the bottom of the content area.
      if (content.length) {
        const low = Math.max(...content.map(({ r }) => r.bottom));
        if (box.bottom - low > limits.maxEmptyPx) fail.push(["unused-space", `content ends ${Math.round(box.bottom - low)}px above the content area's bottom (max ${limits.maxEmptyPx}px)`]);
      }
    }
    // Blue is one accent per slide, at most (charts are checked in their spec: one highlighted bar).
    const accent = /rgb\(34, 0, 255\)/;
    const accented = all.filter((el) => [el, "::before", "::after"].some((pseudo) => {
      const st = pseudo === el ? getComputedStyle(el) : getComputedStyle(el, pseudo);
      if (pseudo !== el && st.content === "none") return false;
      return [st.color, st.backgroundColor, st.backgroundImage, st.borderTopColor, st.borderLeftColor].some((v) => accent.test(v)) && (pseudo !== el || ownText(el) || st.backgroundImage !== "none" || st.borderTopWidth !== "0px" || st.borderLeftWidth !== "0px" || st.backgroundColor !== "rgba(0, 0, 0, 0)");
    }));
    if (accented.length > 1) fail.push(["too-many-accents", `blue used on ${accented.length} elements (max 1): ${accented.slice(0, 4).map(name).join(", ")}`]);
    // At most two text styles (family + weight) on a slide.
    const styles = new Set(all.filter((el) => ownText(el)).map((el) => { const st = getComputedStyle(el); return `${st.fontFamily.split(",")[0].replace(/"/g, "")} ${st.fontWeight}${st.fontStyle === "italic" ? " italic" : ""}`; }));
    if (styles.size > 2) fail.push(["too-many-text-styles", `${styles.size} text styles (max 2): ${[...styles].join("; ")}`]);

    // No orphans: a bullet that wraps must not leave one word alone on its last line.
    const orphan = (el) => {
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const ws = [];
      for (let n; (n = walk.nextNode());) for (const m of n.data.matchAll(/\S+/g)) ws.push([n, m.index, m.index + m[0].length]);
      if (ws.length < 2) return false;
      const top = ([n, a, b]) => { const r = document.createRange(); r.setStart(n, a); r.setEnd(n, b); return r.getClientRects()[0]?.top ?? 0; };
      return Math.abs(top(ws.at(-1)) - top(ws.at(-2))) > 2;
    };
    for (const li of s.querySelectorAll(":scope > ul > li, :scope > ol > li")) {
      if (orphan(li)) fail.push(["orphan-word", `"${li.textContent.trim().split(/\s+/).at(-1)}" sits alone on the last line of a bullet; reword it`]);
    }
    // Readable on its background: text of 24px and up needs a contrast ratio of at least 3:1 (WCAG large text).
    const rgba = (v) => (v.match(/[\d.]+/g) || [0, 0, 0, 0]).map(Number);
    const [br, bgG, bb] = rgba(getComputedStyle(s).backgroundColor);
    const lum = (r, g, b) => [r, g, b].map((c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; })
      .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
    for (const el of all.filter((e) => ownText(e))) {
      const [r, g, b, a = 1] = rgba(getComputedStyle(el).color);
      const mix = (c, k) => c * a + k * (1 - a);
      const [l1, l2] = [lum(mix(r, br), mix(g, bgG), mix(b, bb)), lum(br, bgG, bb)].sort((x, y) => y - x);
      const ratio = (l1 + 0.05) / (l2 + 0.05);
      if (ratio < 3) { fail.push(["low-contrast", `<${name(el)}> text contrast ${ratio.toFixed(1)}:1 (min 3:1)`]); break; }
    }
    // Cover: title, then a one-line subtitle; no apologies or caveats on it.
    if (isTitle) {
      for (const p of s.querySelectorAll(":scope > p")) if (ownText(p) && lineCount(p) > 1) fail.push(["subtitle-wraps", "cover subtitle wraps; keep it to one line"]);
      const coverText = [...s.children].map((el) => el.textContent).join(" ");
      const caveat = coverText.match(/dummy data|draft|placeholder|work in progress|not final/i);
      if (caveat) fail.push(["cover-caveat", `cover says "${caveat[0]}"; move caveats to the demo slide or appendix`]);
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
    const fontOk = await page.evaluate(() => ["Geist", "Newsreader"].every((f) => document.fonts.check(`36px "${f}"`)));
    if (!fontOk) throw new Error("Geist or Newsreader did not load; check assets/fonts and the theme @font-face.");
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
