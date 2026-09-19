#!/usr/bin/env bash
# Post-merge cleanup for Vibe Motion worktrees.
#
# Usage (from the PRIMARY checkout, not from inside a worktree):
#   scripts/cleanup-merged.sh                 # clean every local branch whose PR is merged
#   scripts/cleanup-merged.sh <branch>        # clean one branch (e.g. feat/0-foundation)
#   DRY_RUN=1 scripts/cleanup-merged.sh       # show what would happen
#
# For each candidate branch it:
#   1. verifies the PR for that branch is MERGED on GitHub (never touches open/unmerged work),
#   2. removes the worktree under .worktrees/<branch> (force: build output there is disposable),
#      after pruning that worktree's Docker e2e stacks and images (scripts/e2e-docker.sh prune),
#   3. deletes the local branch and prunes the remote-tracking ref,
#   4. removes temp files the PR flow leaves behind (/tmp/pr<N>_*),
#   5. prints memory.md line(s) that still mention the branch so the caller updates them.
set -euo pipefail

DRY_RUN="${DRY_RUN:-0}"
root="$(git rev-parse --show-toplevel)"
cd "$root"

if [ "$(git rev-parse --git-dir)" != "$(git rev-parse --git-common-dir)" ]; then
  echo "cleanup-merged: run this from the primary checkout, not from inside a worktree." >&2
  exit 2
fi

run() { if [ "$DRY_RUN" = "1" ]; then echo "  [dry-run] $*"; else "$@"; fi; }

protected='^(main|pr_screenshot)$'
git fetch -q --prune origin

if [ $# -ge 1 ]; then
  candidates=("$1")
else
  candidates=()
  while IFS= read -r b; do candidates+=("$b"); done < <(git for-each-ref --format='%(refname:short)' refs/heads | grep -Ev "$protected" || true)
fi

cleaned=0
for br in "${candidates[@]:-}"; do
  [ -z "$br" ] && continue
  [[ "$br" =~ $protected ]] && continue
  pr_json="$(gh pr list --head "$br" --state merged --json number,mergedAt --limit 1 2>/dev/null || echo '[]')"
  num="$(jq -r '.[0].number // empty' <<<"$pr_json")"
  if [ -z "$num" ]; then
    echo "skip  $br  (no merged PR found; open or never had a PR)"
    continue
  fi
  echo "clean $br  (PR #$num merged $(jq -r '.[0].mergedAt' <<<"$pr_json"))"

  wt="$root/.worktrees/$br"
  # Docker e2e stacks and images are tagged per worktree path; drop them before the path goes away.
  if [ -x "$wt/scripts/e2e-docker.sh" ] && command -v docker >/dev/null && docker info >/dev/null 2>&1; then
    run "$wt/scripts/e2e-docker.sh" prune || echo "  e2e-docker prune failed; continuing (run 'scripts/e2e-docker.sh prune-all --yes' later if images linger)"
  fi
  if git worktree list --porcelain | grep -qx "worktree $wt"; then
    run git worktree remove --force "$wt"
  fi
  if [ -d "$wt" ]; then run rm -rf "$wt"; fi   # left behind without registration (crash)
  run git worktree prune

  if git show-ref --verify --quiet "refs/heads/$br"; then
    run git branch -D "$br"
  fi
  if git show-ref --verify --quiet "refs/remotes/origin/$br"; then
    run git branch -dr "origin/$br"
  fi

  for f in /tmp/pr"${num}"_*; do
    [ -e "$f" ] && run rm -f "$f"
  done

  if grep -q -- "$br" memory.md 2>/dev/null; then
    echo "  memory.md still mentions $br — mark the entry done or remove it:"
    grep -n -- "$br" memory.md | sed 's/^/    /'
  fi
  cleaned=$((cleaned + 1))
done

find "$root/.worktrees" -mindepth 1 -type d -empty -delete 2>/dev/null || true

echo "cleanup-merged: $cleaned branch(es) cleaned. Remaining worktrees:"
git worktree list
