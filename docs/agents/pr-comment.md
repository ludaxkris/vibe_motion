# Posting results as a PR comment (shared by every subagent)

Every subagent posts its final report as a comment on the PR it worked on, so findings, results and updates live next to the code and survive the session. One comment per agent per PR: re-runs update the existing comment instead of adding a new one.

## Procedure

1. Find the PR for the current branch: `gh pr view --json number -q .number` (from the worktree). If the caller gave you a PR number, use that. If there is no PR, skip the comment and say so in your report; never create a PR yourself.
2. Write your full report, in the format your definition specifies, to a file in your scratchpad. Do **not** add the marker, heading or footer yourself.
3. Run exactly one command from the repo (any worktree):

   ```bash
   scripts/pr-comment.sh <pr-number> <agent-name> "<short outcome>" <body-file>
   ```

   `agent-name` is one of `code-reviewer`, `test-writer`, `code-architect`, `test-runner`, `screenshot-runner`. Short outcome examples: `APPROVE`, `BLOCKED`, `ALL GREEN`, `RED`, `SOUND WITH CHANGES`, `12 tests added`, `9 screenshots`.

   The script adds the hidden marker `<!-- vibe-motion-agent:<agent-name> -->`, the heading with the PR head sha, and the footer; finds your existing comment by marker and updates it; creates one only if none exists; and removes duplicates. **Never call `gh pr comment` yourself**: that always creates a new comment.
4. Put the URL the script prints in your final report to the caller.

## Rules

- Post exactly what you reported to the caller, not a summary of it. The PR comment is the durable record.
- Never paste secrets, environment values, or full logs. Failing test names and first error lines are fine.
- Screenshot-Runner embeds images by raw URL from the `pr_screenshot` branch; no other agent attaches files.
- Posting a comment never replaces the caller's own PR description duties (gates table, deferred items, memory.md).
