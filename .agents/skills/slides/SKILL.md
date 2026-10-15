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
| Action title | One sentence stating the takeaway, not a topic ("Devin builds an app in a day", not "Build time"). | — |
| Title fits one line | Roughly 70 characters max. | Fails if it wraps (warns over 70 chars) |
| At most three bullets | Each 12 words or fewer. No paragraphs. | Fails on >3 bullets, >12 words, text blocks >20 words |
| One visual | A chart, diagram, table or screenshot. No decorative clip art, icons or logos. | Fails on >1 visual (warns on none) |
| Every number has a source | A `Source: …` footer on any slide with a number or chart. **Never invent numbers.** If a number isn't sourced, leave it out or write "TBD". | Fails on numbers or a chart without a `Source:` footer |
| Only numbers that prove the title | Everything else goes in the appendix. | — |
| Plain words | A VP can read it in five seconds. Explain any jargon on the slide, or cut it. | — |
| Banned words | leverage, seamless, robust, unlock, game changing (any form, also in notes). | Fails |
| Evidence on the slide, reasoning in notes | Speaker notes are what Thomas will say. | Warns if notes are missing |
| Fits the slide | Nothing overflows the slide, the margins or the footer. Body text ≥24 px. | Fails |

## 3. How to write a slide

```markdown
---

<!-- _footer: "Source: Microsoft, Power Apps pricing (research S16)" -->

# Power Apps costs less for under fifty users

- First point, 12 words or fewer
- Second point
- Third point

![Annual cost by option](assets/charts/cost.svg)

<!--
VP question: What does each option cost us?
What I'll say: the reasoning, step by step.
-->
```

- Title is the single `#` heading. Use `1.` lists for ordered next steps.
- Visual options: an image (`![alt](assets/…)`), a Markdown table, `<div class="visual flow"><div>Step</div>…</div>`
  for a simple process diagram, or `<div class="visual placeholder">…</div>` until the real one exists.
  Bullets plus one visual sit side by side automatically.
- Charts: edit `charts/<name>.json` and run `pnpm --filter @fit/presentation charts`.
  A bar with `"value": null` is drawn as a dashed "TBD" bar. Never fill a value without a source.
- Screenshots: 1920×1080, dummy data only, saved in `assets/`.
- Appendix slides: add `<!-- _class: appendix -->`.
- Don't change the theme per slide (no inline styles, fonts or colours). Theme changes go in
  `themes/consultancy.css` and need a fresh check run.

## 4. Check, then export

Run from the repo root:

```bash
pnpm install
pnpm --filter @fit/presentation setup:browser   # once per machine: Playwright Chromium
pnpm --filter @fit/presentation check           # must pass; screenshots in presentation/dist/check/slides/
pnpm --filter @fit/presentation check:selftest  # after changing check.mjs or the theme
pnpm --filter @fit/presentation export          # dist/slides.html, slides.pdf, slides.pptx
```

- `check` renders every slide at 1920×1080, saves `slide-NN.png`, and exits non-zero on any failure.
  Look at the screenshots too: the script can't judge whether the title is a real takeaway.
- Paste the storyline and the check output in the PR, and attach the screenshots.
- The PPTX export is one image per slide with speaker notes (Marp default), so it isn't editable in
  PowerPoint. The PDF carries notes as annotations.
- `dist/` is gitignored. Don't commit exports.
- Log the session in `docs/DEVIN-LOG.md` (AGENTS.md rule 9).
