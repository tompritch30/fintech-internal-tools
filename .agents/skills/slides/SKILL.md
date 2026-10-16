---
name: slides
description: Build or edit slides in presentation/ (Marp). Storyline first from Thomas's titles, consultancy rules (one-line action titles, ≤3 bullets, one visual, sourced numbers), then run the check script before any PR.
---

# Slides (Marp, `presentation/`)

Use this for any change to `presentation/slides.md`, its theme, charts or exports.
The audience is a VP. Every slide must be readable in five seconds.

## 1. Storyline first

1. **Don't invent the storyline.** Thomas provides it. If he hasn't, ask; don't draft one.
2. Before building any slide, write **only the titles**, in order, and send them to Thomas.
   Read on their own, the titles must tell the whole story.
   `pnpm --filter @fit/presentation check` prints them under "Storyline".
3. Each slide answers **one question the VP has**. Note that question in the speaker notes.
4. Build the slides only after the titles read as a story.

## 2. Rules for every slide

| Rule | Detail | Checked by script |
|---|---|---|
| Action title | One sentence stating the takeaway, not a topic ("Power Apps costs $250K a year", not "Cost"). | — |
| Title fits one line | Roughly 70 characters max. | `title-wraps` (warns over 70 chars) |
| At most three bullets | Each 12 words or fewer. No paragraphs. No single word alone on a bullet's last line. | `too-many-bullets`, `bullet-too-long`, `paragraph`, `orphan-word` |
| One visual | A chart, diagram, table or screenshot. No clip art or icons; the theme's Cognition mark is the only logo. | `too-many-visuals` (warns on none) |
| Every number has a source | A plain-words `Source: …` footer on any slide with a number or chart ("Source: client spend figure; Microsoft Power Apps pricing"). No codes like `S22`. **Never invent numbers.** | `number-without-source` |
| Unmeasured stays unmeasured | Put it in a small table saying it is measured in the pilot. Never an empty box, guessed bar or `[TBD]` bar. | chart generator refuses a bar with no value |
| Plain words | A VP can read it in five seconds. Banned: leverage, seamless, robust, unlock, game changing (also in notes). | `banned-word` |
| No en or em dashes | Not in slide text, notes or drawn SVG labels (cover art, charts). Use a comma, colon or "to". | `em-dash` |
| Evidence on the slide, reasoning in notes | Speaker notes are what Thomas will say. | warns if notes are missing |
| Fits the slide | Nothing overflows the slide, the margins or the footer. All text ≥24 px. | `overflow`, `text-too-small`, `chart-text-too-small` |

## 3. Tool choice (decided 2026-10-15; don't re-litigate without a reason)

- **Marp**, with our own `themes/cognition.css`. Markdown source, PNG/PDF/PPTX export, and our checker and
  selftest already run on it. The "hand-drawn" look was our old theme, not Marp.
- Rejected: **Slidev** (best-looking defaults, PNG/PDF/PPTX, but Vue + Vite and a checker rewrite for a ~10-slide deck);
  **reveal.js** (HTML-first, PDF via browser print or decktape, no PPTX); **HTML slide skills** such as
  frontend-slides (good looks, but no Markdown source and no export pipeline).
- **Charts: Apache ECharts**, server-side SVG (`scripts/chart.mjs`, specs in `charts/*.json`). Never draw bars by hand.
- **Cover art**: `art/title-art.py` draws our own SVG and refuses to write it if a label or block leaves the
  margin or touches another. Never copy Cognition's artwork.

## 4. Look: Cognition, from cognition.com (computed styles, 2026-10-15)

- Paper `#f7f6f5`, ink `#000`, grey `rgba(25,25,25,.56)` for secondary text, one accent blue `#2200ff`.
- Fonts: the site's NB International and stkBureauSerif are paid, so we use **Newsreader** (titles) and **Geist**
  (everything else). That's the whole type system: two text styles per slide, serif title plus Geist regular in
  black or grey. No mono labels, no bold, no italics.
- Hairline column rules with small tick marks at the top, as on the site.
- Small Cognition mark bottom left on every slide, linked to https://cognition.com (`header:` directive).
- **Cover**: near-black, white mark, light line art in its own panel, blue corner marks exactly on the panel's
  corners. Left column: big mark, title, one-line subtitle. "Prepared for … · Month Year" in the footer band.
  No caveats on the cover ("draft", "dummy data"); those go on the demo slide or in the appendix. Big logo only here.

## 5. Structure and conventions from real consulting decks

Studied: McKinsey's USPS deck, Bain's Global PE Report 2023 and BCG's Dallas recommendations (via slideworks.io).

- Main deck is short: **scene, business value, demo, cost**. Everything else is appendix, ending with a sources page.
- Title states the takeaway, often with the number in it. One message per slide.
- A small section label above the title ("04 · Cost", "Appendix"). No "DRAFT" in labels.
- Charts: every bar grey except the one that proves the title, in blue. Units in a subtitle or the label, one unit
  and period per chart. No gridlines.
- Comparisons and recommendations are tables: column 1 the thing compared, column 2 the evidence, column 3 the so-what.
  Short phrases, regular weight, at most 4 rows.
- Cost slides: compare like with like. Not "60 Devin seats vs the licence": internal tools don't need every engineer
  on Devin. Frame it as Power Apps today and next year vs the cost to build each app, with the date the price was checked.
- Source line bottom left, page number bottom right.

## 6. Layout checklist: think like a PowerPoint slide master

Every slide uses the same placeholders: label, title and content start on **one left edge**, the content row
fills the space between title and footer, and the footer band (logo, source, page number) is fixed. Check every
rendered PNG, not just the slide you changed. The script catches most of this; the rest is by eye.

| Check | Script code | By eye |
|---|---|---|
| Nothing touches or overlaps (≥24 px between blocks); no text over art | `elements-touch` | text over a drawing's own detail |
| A block's content stays inside the block (a squeezed grid row can let a chart spill over the next block) | `spills-out` | — |
| One left edge for label, title, content, logo | `off-left-edge` | chart labels and table text start on it too |
| One spacing step (48 px): label→title equals title→content | `uneven-gaps` | even gaps inside diagrams and between table rows |
| Content uses the space; no blank band at the bottom | `unused-space` | the slide doesn't look top-heavy |
| Blue once per slide at most (one bar, one header, one step or the corner marks) | `too-many-accents`; `charts` refuses more than one highlighted bar | no other colours anywhere |
| Two text styles per slide | `too-many-text-styles` | — |
| Readable: ≥24 px, contrast ≥3:1 | `text-too-small`, `low-contrast` | a VP gets it in five seconds |
| Source line fits on one line | `overflow` (clipped footer) | it's plain words |
| Drawings shown at their own shape, so frames and corner marks sit on the corners | `image-aspect` | corner marks are on the frame's corners |
| Cover: one-line subtitle, no caveats | `subtitle-wraps`, `cover-caveat` | title first, then subtitle, then details |
| No orphan word on a bullet's last line | `orphan-word` | also in table cells and placeholders |

Mistakes this checklist came from (2026-10-15): a label indented past the title; uneven header gaps; blue on
labels, bullets and headers at once; mono, bold, serif and sans on one slide; a clipped source line; "DRAFT" on
every label; tables that stopped halfway down the slide; the cover title on top of the art; a drawing squashed into
a box of a different shape, so its corner marks floated; chart labels inset from the left edge. Content pass
(2026-10-16): an em dash drawn inside the cover art's SVG, invisible to the DOM checks; alt text with "$1.4M"
silently corrupting the chart SVG (a `$1` capture group in `String.replace`); a two-line chart label crowding the
bar above it; a screenshot with a 1 px border running past the right margin; a dense cost slide that could not fit
at 24 px until split, and a one-slide try at it where the chart spilled over the roadmap while every
block-to-block check still passed (now `spills-out`). When you find a new
kind of mistake, add a check (with a fixture slide in `test/fixtures/violations.md`) or a by-eye row here.

### When Thomas writes the text himself

- Use it **word for word**: titles, bullets, cells, footers and narration. Change layout, never words or numbers.
- Before building, check his numbers against the repo and CI (test counts, PR counts, ranges that should match
  between a slide and its appendix) and send him the mismatches. Use his figures until he answers.
- If his text breaks a rule (long title, long bullet, a banned word), keep the text and add an
  `allow-<code>` class to that slide (`<!-- _class: long allow-title-wraps allow-bullet-too-long -->`). The check
  then prints the failure as an "allowed" warning instead of failing. Never loosen the global limits for one deck.
  List every allowed exception in the PR so he can decide.
- Long main-deck text: add the `long` class (30 px body). Still nothing under 24 px.
- If a slide can't hold everything at 24 px or more, split it ("1 of 2", "2 of 2") and tell him; don't cut words.
- His narration goes in the slide's HTML comment (presenter notes), unchanged. Label demo notes "Before the demo:" /
  "After the demo:" when he gives both.
- Footers keep the `Source: ` prefix the check needs, then his words.

### Writing a slide

```markdown
---

<!-- _footer: "Source: client spend figure; Microsoft Power Apps pricing and licensing pages" -->

###### 01 · The scene

# Power Apps bills per user, so moving one app frees no seats

- At most three short bullets

<div class="visual flow"><div><small>Today</small>Uses 3 apps, pays 1 seat</div>…</div>

<!-- What Thomas says. -->
```

- Appendix slides: `<!-- _class: appendix -->`. Cover: `<!-- _class: title -->`.
- A slide that continues another keeps the label count ("Appendix A4 · 2 of 3") and adds "(continued)" to its title.
  A main-deck slide split in two gets its own label (04a, 04b) and its own action title.
- Recommendation without colour: give the chart bar `"tag": "recommended"` (an outlined ink label) and keep every
  bar grey, so the slide spends no blue.
- Cost tables: one row per line item, columns line item, A, B, C, basis; amounts don't wrap; a blank cell means
  the line isn't part of that option (say so in the notes). Split across slides by rows, not by columns.
- One accent on a table: wrap one header in `*…*` (shows blue). Charts: `"highlight": true` on one bar.
- Chart specs also take `"from"` (a range: solid to `from`, a thin span with end caps to `value`), `"parts"`
  (a stacked bar, `"ink": true` for the dark part), `"text"` (the value label), `"labelsAbove"` with `"labelLines"`
  (labels over the bars, wrapping), and `"width"`, `"barHeight"`, `"bandGap"` to fit a column.
- Screenshots come from the running app (`docker compose up --build`), signed in as the user the slide is about,
  cropped to the record header and status. Crop out anything that breaks a deck rule (an em dash in the UI).
- Screenshots: 1920×1080, dummy data only, cropped to what proves the title. Until one exists, a
  `<div class="visual placeholder">` saying why it's missing.
- Write appendix facts from the source document, not memory, and keep the sources page in step with every number.
- No inline styles. Theme changes go in `themes/cognition.css`, then re-run `check` and `check:selftest`.
- Keep a copy of the first round's PNGs outside `dist/` so the PR can show before and after.

## 7. Check, then export

Run from the repo root:

```bash
pnpm install
pnpm --filter @fit/presentation setup:browser   # once per machine: Playwright Chromium
pnpm --filter @fit/presentation check           # must pass; screenshots in presentation/dist/check/slides/
pnpm --filter @fit/presentation check:selftest  # after changing check.mjs or the theme
pnpm --filter @fit/presentation export          # dist/slides.html, slides.pdf, slides.pptx
```

- `check` renders every slide at 1920×1080, saves `slide-NN.png`, and exits non-zero on any failure.
  Then do the by-eye pass in section 6 on every PNG: the script can't judge everything.
- Paste the storyline and the check output in the PR, and attach the screenshots.
- The PPTX export is one image per slide with speaker notes (Marp default), so it isn't editable in
  PowerPoint. The PDF carries notes as annotations.
- `dist/` is gitignored. Don't commit exports.
- Log the session in `docs/DEVIN-LOG.md` (AGENTS.md rule 9).
