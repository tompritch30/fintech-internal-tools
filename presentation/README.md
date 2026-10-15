# Presentation

Marp deck in `slides.md`, 16:9 at 1920×1080, with the `consultancy` theme in `themes/`.
The rules for writing slides, and the workflow, are in
[`.agents/skills/slides/SKILL.md`](../.agents/skills/slides/SKILL.md).

| Task | Command (from the repo root) |
|---|---|
| Install | `pnpm install`, then `pnpm --filter @fit/presentation setup:browser` once |
| Check every slide (fails on wrapped titles, overflow, >3 bullets, …) | `pnpm --filter @fit/presentation check` |
| Prove the checker catches each rule | `pnpm --filter @fit/presentation check:selftest` |
| Rebuild charts from `charts/*.json` | `pnpm --filter @fit/presentation charts` |
| Export HTML, PDF and PowerPoint to `dist/` | `pnpm --filter @fit/presentation export` |
| One format only | `export:html`, `export:pdf`, `export:pptx` |

- Screenshots from the check go to `dist/check/slides/slide-NN.png`, with `report.json`.
- Exports use Playwright's Chromium, or `CHROME_PATH` if set.
- Font: Inter (SIL Open Font License, `assets/fonts/OFL.txt`), vendored so every export looks the same offline.
- Palette: Cognition's off-white `#f7f6f5`, ink `#191919` and accent `#2200ff` (from cognition.ai's CSS),
  plus Devin's blue `#317cff` (from devin.ai's CSS). No logos; the wordmark is the `header:` text.
- Live preview in VS Code: the Marp extension, with `markdown.marp.themes` set to `./presentation/themes/consultancy.css`
  and `markdown.marp.enableHtml` on.
