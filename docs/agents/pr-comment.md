# Posting results as a PR comment (shared by every subagent)

Every subagent posts its final report as a comment on the PR it worked on, so findings, results and updates live next to the code and survive the session. One comment per agent per PR: re-runs update the existing comment instead of adding a new one.

## Procedure

1. Find the PR for the current branch: `gh pr view --json number,url -q '.number'` (from the worktree). If the caller gave you a PR number, use that. If there is no PR, skip the comment and say so in your report; never create a PR yourself.
2. Write the comment body to a temp file. Start it with the marker line for your agent, then a heading, then your full report in the format your definition specifies:

   ```
   <!-- vibe-motion-agent:<agent-name> -->
   ## 🤖 <agent-name> — <short outcome> · `<short sha>`

   <your report>

   <sub>Posted by the `<agent-name>` subagent · <ISO date>. Re-runs update this comment.</sub>
   ```

   Markers: `<!-- vibe-motion-agent:code-reviewer -->`, `test-writer`, `code-architect`, `test-runner`, `screenshot-runner`. Short outcome examples: `APPROVE`, `BLOCKED`, `ALL GREEN`, `RED`, `SOUND WITH CHANGES`, `12 tests added`, `9 screenshots`.
3. Upsert:

   ```bash
   PR=<number>; MARKER='<!-- vibe-motion-agent:<agent-name> -->'; BODY=/path/to/body.md
   REPO=$(gh repo view --json nameWithOwner -q .nameWithOwner)
   CID=$(gh api "repos/$REPO/issues/$PR/comments?per_page=100" --jq ".[] | select(.body | startswith(\"$MARKER\")) | .id" | head -1)
   if [ -n "$CID" ]; then
     gh api -X PATCH "repos/$REPO/issues/comments/$CID" -F body=@"$BODY" >/dev/null && echo "updated comment $CID"
   else
     gh pr comment "$PR" --body-file "$BODY"
   fi
   ```
4. Put the comment URL in your final report to the caller (`gh pr view $PR --json url -q .url` + `#issuecomment-<id>`, or the URL `gh pr comment` prints).

## Rules

- Post exactly what you reported to the caller, not a summary of it. The PR comment is the durable record.
- Never paste secrets, environment values, or full logs. Failing test names and first error lines are fine.
- Screenshot-Runner embeds images by raw URL from the `pr_screenshot` branch; no other agent attaches files.
- Posting a comment never replaces the caller's own PR description duties (gates table, deferred items, memory.md).
