# Raw notes (scratch — deletable)

## Timeline (UTC, 2026-10-14)
- 20:32 start: brief received, repo cloned (only README + .gitignore, no pre-commit hooks)
- 20:33–20:36 fetched about 30 candidate pages with curl; grepped for quotes
- 20:36–20:40 picked 15 sources, wrote research.md / requirements.md
- See the PR / final message for the end time

## Fetch issues
- eCFR.gov / federalregister.gov blocked automated requests (CAPTCHA). The eCFR API returned an empty body, and govinfo's CFR XML had no matching text. Used the Cornell LII copy of 31 CFR 1020.220 instead.
- learn.microsoft.com test-engine/overview now redirects to the "important changes" deprecations page.

## Candidate sources found but excluded (15-source cap). Not used as evidence.
- https://learn.microsoft.com/en-us/power-platform/admin/environments-overview — environment types (production/sandbox/trial)
- https://learn.microsoft.com/en-us/power-platform/alm/basics-alm — ALM basics
- https://learn.microsoft.com/en-us/power-apps/maker/canvas-apps/test-studio — Test Studio
- https://learn.microsoft.com/en-us/power-platform/admin/wp-security-cds — Dataverse security roles / business units
- https://github.com/appsmithorg/appsmith, https://github.com/ToolJet/ToolJet — OSS internal-tool builders
- https://bsaaml.ffiec.gov/manual — FFIEC BSA/AML manual (fetch returned almost nothing)

## Second pass (cap raised to 20)
- Added S16 (managed environment licensing, February 2027 enforcement), S17 (per-app end of sale), S18 (Approvals connector reference, self-approval), S19 (release plans → AI at Work roadmap), S20 (licensing FAQ prices).
- "$22": searched the pricing page, licensing FAQ, licensing overview, Learn search API, and Partner Center announcements (2025-11 to 2026-10). No match. "February 27" is most likely February 2027 (the S16 enforcement date).
- Self-approval: Learn search found no page saying approvals block the requester. Connector reference (S18) shows Requestor is an optional free-text field.
- Also seen, not cited: Partner Center March 2026 announcement that per-app is returning to the CSP price list (https://learn.microsoft.com/en-us/partner-center/announcements/2026-march).

## Follow-ups if more time
- Use a second pass to swap the vendor sources for the excluded Microsoft licensing/roadmap pages, if Q6 matters more than Q7.
- Check the MSB recordkeeping rule (31 CFR 1022) if the client is not a bank.
