# GOVERNANCE.md — repo controls

The controls on this repo, and how to give a new repo the same ones. The GitHub
part is code (`.github/rulesets/main.json` plus a script); the Devin part is a
checklist of settings.

Working rules for sessions are in [AGENTS.md](../AGENTS.md); what Devin Review checks
is in [REVIEW.md](../REVIEW.md).

## 1. GitHub: ruleset `protect-main` on the default branch

Source of truth: [.github/rulesets/main.json](../.github/rulesets/main.json), exported
from the live ruleset with a read-only `GET /repos/{owner}/{repo}/rulesets/{id}`.

| Control | Ruleset setting | Effect |
|---|---|---|
| No force pushes | `non_fast_forward` | History on `main` can't be rewritten |
| No deletion | `deletion` | `main` can't be deleted |
| PR required | `pull_request` | Every change to `main` goes through a PR |
| 0 approvals on ordinary PRs | `required_approving_review_count: 0` | Devin may merge ordinary PRs itself once checks pass (AGENTS.md) |
| Code-owner approval on owned paths | `require_code_owner_review: true` | PRs touching paths in [CODEOWNERS](../.github/CODEOWNERS) (`packages/core/`, `AGENTS.md`, `.devin/`, `.github/`, `packages/db/migrations/`) need @tompritch30 |
| Stale approvals dismissed | `dismiss_stale_reviews_on_push: true` | A new push after approval needs re-approval |
| Extra approval for unattributed changes | `require_extra_approval_for_unattributed_changes: true` | GitHub's default for new rulesets; kept as is |
| Squash merges only | `allowed_merge_methods: ["squash"]` | One commit per PR on `main` |
| Required checks | `required_status_checks`: `verify`, `e2e` (GitHub Actions) | Shown in the PR as `CI / verify` and `CI / e2e` |
| Branch up to date before merge | `strict_required_status_checks_policy: true` | A PR must be rebased on the latest `main` (and its checks re-run) before it can merge |
| Bypass | none listed | Nobody bypasses the ruleset |

Repo-level merge settings still allow merge commits and rebase merges; the ruleset
overrides them for `main`.

## 2. Devin

| Control | Where | Effect |
|---|---|---|
| Devin Review on every PR, mode **Auto review** | [Settings > Review](https://app.devin.ai/settings/review) | Reviews when a PR opens, on every push, and when a draft is marked ready; checks [REVIEW.md](../REVIEW.md) |
| Auto-fix for Devin Review comments | Devin Review settings | The session that owns the PR gets the findings and fixes them |
| Environment snapshot from [.devin/blueprint.yaml](../.devin/blueprint.yaml) | Devin environment settings (repo blueprint) | Every session starts with Node 24, pnpm and dependencies installed |

## 3. New repo checklist

**GitHub** (needs a repo admin):
1. Copy `.github/CODEOWNERS` (change the owners), `.github/workflows/ci.yml` (keep the
   job names `verify` and `e2e`), `.github/pull_request_template.md`, `REVIEW.md` and
   `AGENTS.md`.
2. Dry run (GET requests only; warns if CODEOWNERS or the check jobs are missing):
   `scripts/setup-repo-governance.sh <owner/repo>`
3. Apply (asks you to type the repo name to confirm):
   `scripts/setup-repo-governance.sh <owner/repo> --apply`
   It updates a ruleset with the same name if there is one, otherwise creates it.

Devin never runs step 3; a human admin does.

**Devin:**
1. Give the Devin GitHub app access to the repo.
2. Add the repo in [Settings > Review](https://app.devin.ai/settings/review) with mode
   **Auto review**, and turn on auto-fix.
3. Commit `.devin/blueprint.yaml` and build the environment snapshot from it.
