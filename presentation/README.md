# Presentation

Marp deck in `slides.md`, 16:9 at 1920×1080, with the `cognition` theme in `themes/`.
The rules for writing slides, and the workflow, are in
[`.agents/skills/slides/SKILL.md`](../.agents/skills/slides/SKILL.md).

| Task | Command (from the repo root) |
|---|---|
| Install | `pnpm install`, then `pnpm --filter @fit/presentation setup:browser` once |
| Check every slide (fails on wrapped titles, overflow, >3 bullets, …) | `pnpm --filter @fit/presentation check` |
| Prove the checker catches each rule | `pnpm --filter @fit/presentation check:selftest` |
| Rebuild charts from `charts/*.json` | `pnpm --filter @fit/presentation charts` |
| Redraw the cover art | `python3 presentation/art/title-art.py` |
| Export HTML, PDF and PowerPoint to `dist/` | `pnpm --filter @fit/presentation export` |
| One format only | `export:html`, `export:pdf`, `export:pptx` |

- Screenshots from the check go to `dist/check/slides/slide-NN.png`, with `report.json`.
- Exports use Playwright's Chromium, or `CHROME_PATH` if set.
- Fonts (SIL Open Font License, vendored in `assets/fonts/` from @fontsource): Newsreader for titles and Geist for
  everything else, free stand-ins for cognition.com's paid stkBureauSerif and NB International.
- Palette from cognition.com's CSS (2026-10-15): paper `#f7f6f5`, ink `#000`, grey `rgba(25,25,25,.56)`, one accent `#2200ff`.
- The small Cognition mark (`assets/cognition-mark.svg`, from cognition.com) is the `header:` link, bottom left on every slide.
- Charts: Apache ECharts, rendered to SVG on the server (`scripts/chart.mjs`; spec options are listed at the top of that file). Cover drawing: `art/title-art.py`.
- Demo screenshot: `assets/screens/refund-waiting.png`, taken from the local compose stack signed in as `senior` (dummy data).
- Live preview in VS Code: the Marp extension, with `markdown.marp.themes` set to `./presentation/themes/cognition.css`
  and `markdown.marp.enableHtml` on.
