#!/usr/bin/env bash
# Upsert a subagent's report as a PR comment: one comment per agent per PR.
#
#   scripts/pr-comment.sh <pr-number> <agent-name> <outcome> <body-file>
#
#   agent-name : code-reviewer | test-writer | code-architect | test-runner | screenshot-runner
#   outcome    : short text for the heading, e.g. "ALL GREEN", "BLOCKED", "APPROVE", "9 screenshots"
#   body-file  : the agent's full report in markdown (WITHOUT marker/heading/footer; this adds them)
#
# Finds the existing comment by its hidden marker and PATCHes it; creates one only if none
# exists. If several exist (an agent posted by hand), the newest is updated and the rest deleted.
# Prints the comment URL. Works from any worktree.
set -euo pipefail

if [ $# -ne 4 ]; then
  echo "usage: scripts/pr-comment.sh <pr-number> <agent-name> <outcome> <body-file>" >&2
  exit 2
fi
pr="$1"; agent="$2"; outcome="$3"; body_file="$4"

case "$agent" in
  code-reviewer|test-writer|code-architect|test-runner|screenshot-runner) ;;
  *) echo "pr-comment: unknown agent '$agent'" >&2; exit 2 ;;
esac
[ -s "$body_file" ] || { echo "pr-comment: body file '$body_file' is missing or empty" >&2; exit 2; }

marker="<!-- vibe-motion-agent:${agent} -->"
repo="$(gh repo view --json nameWithOwner -q .nameWithOwner)"
sha="$(gh pr view "$pr" --json headRefOid -q '.headRefOid[0:7]')"
today="$(date -u +%Y-%m-%d)"

tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT
{
  printf '%s\n' "$marker"
  printf '## 🤖 %s — %s · `%s`\n\n' "$agent" "$outcome" "$sha"
  cat "$body_file"
  printf '\n\n<sub>Posted by the `%s` subagent · %s. Re-runs update this comment.</sub>\n' "$agent" "$today"
} > "$tmp"

ids=()
while IFS= read -r id; do [ -n "$id" ] && ids+=("$id"); done < <(
  gh api --paginate "repos/$repo/issues/$pr/comments?per_page=100" \
    --jq ".[] | select(.body | startswith(\"$marker\")) | .id"
)

if [ "${#ids[@]}" -eq 0 ]; then
  url="$(gh api -X POST "repos/$repo/issues/$pr/comments" -F body=@"$tmp" --jq .html_url)"
  echo "created $url"
else
  keep="${ids[${#ids[@]}-1]}"
  url="$(gh api -X PATCH "repos/$repo/issues/comments/$keep" -F body=@"$tmp" --jq .html_url)"
  echo "updated $url"
  for id in "${ids[@]}"; do
    [ "$id" = "$keep" ] && continue
    gh api -X DELETE "repos/$repo/issues/comments/$id" >/dev/null && echo "removed duplicate $id"
  done
fi
