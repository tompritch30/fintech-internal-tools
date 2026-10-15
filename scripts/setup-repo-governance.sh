#!/usr/bin/env bash
# Applies the main-branch ruleset in .github/rulesets/main.json to a GitHub repo.
# Dry run by default: only GET requests, then prints what it would do.
# Usage: scripts/setup-repo-governance.sh <owner/repo> [--apply]
# Needs: gh (authenticated with admin rights on the repo for --apply) and jq.
# Devin settings (Review auto mode, auto-fix, blueprint snapshot) are manual: see docs/GOVERNANCE.md.
set -euo pipefail

usage() { echo "Usage: $0 <owner/repo> [--apply]" >&2; exit 2; }
[[ $# -ge 1 && $# -le 2 ]] || usage
repo="$1"
apply=false
if [[ $# -eq 2 ]]; then [[ "$2" == "--apply" ]] || usage; apply=true; fi
[[ "$repo" =~ ^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$ ]] || { echo "Not an owner/repo: $repo" >&2; exit 2; }

for cmd in gh jq; do command -v "$cmd" >/dev/null || { echo "Missing $cmd" >&2; exit 1; }; done
ruleset_file="$(cd "$(dirname "$0")/.." && pwd)/.github/rulesets/main.json"
name="$(jq -r .name "$ruleset_file")"

# Required checks only report if the target repo has a workflow with these job names.
checks="$(jq -r '.rules[] | select(.type=="required_status_checks") | .parameters.required_status_checks[].context' "$ruleset_file")"
warn=0
if ! gh api --method GET "repos/$repo/contents/.github/CODEOWNERS" >/dev/null 2>&1; then
  echo "WARNING: $repo has no .github/CODEOWNERS; code-owner review will have no owners." >&2; warn=1
fi
workflows="$(gh api --method GET "repos/$repo/contents/.github/workflows" --jq '.[].path' 2>/dev/null || true)"
for check in $checks; do
  found=false
  for wf in $workflows; do
    if gh api --method GET "repos/$repo/contents/$wf" --jq .content | base64 -d | grep -Eq "^  ${check}:"; then found=true; fi
  done
  $found || { echo "WARNING: no workflow job named '$check' in $repo; PRs would wait on it forever." >&2; warn=1; }
done

existing_id="$(gh api --method GET "repos/$repo/rulesets" --jq ".[] | select(.name==\"$name\") | .id")"
if [[ -n "$existing_id" ]]; then
  action="update ruleset '$name' (id $existing_id)"; method=PUT; path="repos/$repo/rulesets/$existing_id"
else
  action="create ruleset '$name'"; method=POST; path="repos/$repo/rulesets"
fi

if ! $apply; then
  echo "Dry run. Would $action on $repo with:"
  jq . "$ruleset_file"
  [[ $warn -eq 0 ]] || echo "Fix the warnings above before applying." >&2
  echo "Re-run with --apply to make the change."
  exit 0
fi

read -r -p "Apply: $action on $repo? Type the repo name to confirm: " confirm
[[ "$confirm" == "$repo" ]] || { echo "Not confirmed; nothing changed." >&2; exit 1; }
gh api --method "$method" "$path" --input "$ruleset_file" --jq '"Done: ruleset \(.name) id \(.id), enforcement \(.enforcement)"'
