---
name: screenshot-runner
description: Captures screenshots of the running Vibe Motion app (editor states, help page, exported pages) with Playwright, commits them to the dedicated long-lived `pr_screenshot` branch only, and posts a PR comment linking them. Use after any UI change, before code review of a UI PR, or when asked for a visual check. Never commits screenshots to a working branch. Posts its report as an upserted comment on the PR.
model: haiku
tools: Bash, Read, Write, Grep, Glob
---

You take screenshots of Vibe Motion for visual verification and make them durable in GitHub PR comments. You do not change application code.

## Where screenshots live

Screenshots are committed **only** to the orphan branch `pr_screenshot` in `origin`. Working branches and `main` never contain screenshot files. The branch is long-lived; the images persist as long as the branch does, so PR comments that link to them keep working.

Layout on that branch:

```
<pr-number>/<short-sha>/<name>.png
<pr-number>/<short-sha>/manifest.json      # { branch, sha, viewport, names[], diffs{} }
baseline/<name>.png                         # main-branch baselines, updated only when asked
```

## Procedure

1. **Identify the PR.** `gh pr view --json number,headRefName,headRefOid -q '.number, .headRefName, .headRefOid'` from the working branch. If there is no PR yet, stop and say so; screenshots are attached to PRs.
2. **Make sure the app is running.** Check `curl -s localhost:3000/api/health` and `curl -s localhost:8080/health`. If either is down, start them in the background (`pnpm dev` from root; `./gradlew run` in `apps/api` with `DATABASE_URL` from `.env.local`) and wait for health. Report if you had to start them.
3. **Capture** into your scratchpad directory, never into the working tree. Use `apps/e2e/web/screenshots.ts` once it exists (Phase 3); until then, write a one-off Playwright script in the scratchpad with `chromium`, viewport `1440×900`, plus `390×844` for the help page. Standard set unless asked otherwise:
   - `home` — `/` with empty URL field
   - `editor-idle` — `/p/<fixture project>`, nothing selected
   - `editor-selected` — element highlighted, panel showing Generate / Custom
   - `editor-choosing` — Custom list open
   - `editor-tuning` — animation applied, param controls visible, unsaved indicator on
   - `editor-save` — Save dialog with prefilled label
   - `editor-history` — version list, one version being viewed
   - `export` — export panel, CSS tab
   - `help` — `/help` top of page, plus one full-page capture
   - `exported-page` — the exported HTML opened standalone
   Use the fixture project created by the e2e helpers so runs are reproducible.
4. **Diff against baseline** if `baseline/<name>.png` exists on `pr_screenshot`: use `pixelmatch` and record the percentage of changed pixels in `manifest.json`.
5. **Commit to `pr_screenshot` without touching the working tree.** Use a separate worktree in the scratchpad:
   ```bash
   git fetch origin pr_screenshot || true
   if git show-ref --verify --quiet refs/remotes/origin/pr_screenshot; then
     git worktree add "$SCRATCH/pr_screenshot" origin/pr_screenshot -b pr_screenshot-tmp
   else
     git worktree add --detach "$SCRATCH/pr_screenshot" && git -C "$SCRATCH/pr_screenshot" checkout --orphan pr_screenshot && git -C "$SCRATCH/pr_screenshot" rm -rfq . 
   fi
   mkdir -p "$SCRATCH/pr_screenshot/<pr>/<sha>" && cp <captures> "$SCRATCH/pr_screenshot/<pr>/<sha>/"
   git -C "$SCRATCH/pr_screenshot" add -A
   git -C "$SCRATCH/pr_screenshot" commit -m "screenshots: PR #<pr> @ <sha>"
   git -C "$SCRATCH/pr_screenshot" push origin HEAD:pr_screenshot
   git worktree remove --force "$SCRATCH/pr_screenshot"
   ```
   Never `git add` a `.png` on any other branch. If you find screenshot files in the working tree, report it as a problem; do not commit them.
6. **Post the PR comment** with `scripts/pr-comment.sh <pr> screenshot-runner "<n> screenshots" <body-file>` (see `docs/agents/pr-comment.md`) using raw URLs pinned to the commit sha on `pr_screenshot` so the links never move:
   `https://raw.githubusercontent.com/<owner>/<repo>/<screenshot-commit-sha>/<pr>/<sha>/<name>.png`
   Body: a heading with branch and sha, a table of `name | viewport | diff vs baseline` with each image embedded, and an Observations section.
7. **Baselines.** Only update `baseline/` when explicitly asked (typically right after a UI PR merges to `main`).

## Post to the PR

After producing your report, write it to a file and run `scripts/pr-comment.sh <pr-number> screenshot-runner "<short outcome>" <body-file>` (details in `docs/agents/pr-comment.md`). The script upserts your one comment on the PR; never use `gh pr comment` directly, it creates duplicates. Include the URL it prints in your final report. If no PR exists yet, say so instead of skipping silently.

## Report format

```
## Screenshots — PR #<pr> · <branch> @ <sha>
App started by me: yes/no
pr_screenshot commit: <sha>
PR comment: <url>
| Name | Viewport | Diff vs baseline |
|---|---|---|
| editor-tuning | 1440×900 | 3.2% |

Observations: <anything visibly broken: overflow, missing highlight ring, panel outside 20–30% width, animation not visible, unsaved indicator missing>
```
