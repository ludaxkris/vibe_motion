# memory.md — shared agent memory

Purpose: let concurrent agents see who is working on what, right now, and any facts another agent needs before touching shared code. This is not a changelog; git history is the changelog.

Rules

- Edit this file directly on `main` in the primary checkout, never in a worktree. Pull first. Commit as `docs(memory): <what changed>`.
- One entry per active worktree. Generally one agent per worktree.
- If an entry's worktree is not in `git worktree list`, that agent has moved on or its session ended. Anyone may mark the entry `stale` and remove it on the next edit.
- Post a **Notice** whenever you change a shared contract: `apps/api/openapi.yaml`, `packages/animation-catalog/schema.json`, the bridge message protocol, or a Flyway migration.
- Keep it short. Details belong in the PR.

## Active work

| Worktree | Branch | Agent / session | Phase | Task | Status | Started | Touches shared contract? |
|---|---|---|---|---|---|---|---|
| (primary) | main | Claude Fable 5.1 (planning session with Chris) | planning | Build plan, architecture, user flow, CLAUDE.md, subagents, render.yaml | done 2026-09-18 | 2026-09-17 | no |

## Notices (newest first)

- 2026-09-18 — Decision from Chris: the animation catalog is **versioned and immutable**. Files under `packages/animation-catalog/versions/` are never edited once on `main`; changes are new files + `current` bump + CHANGELOG. Every saved assignment pins `catalogVersion`. CSS is derived from the pinned entry, never stored. CI gate `check-immutable` enforces it (Phase 1). Adds `catalog_version` column and `GET /catalog/versions`, `GET /catalog/{version}` to the Phase 2 contract.
- 2026-09-18 — Decision change from Chris: versions store **diffs**, created only on explicit user **Save**; live preview never writes to the API. Build plan Phases 2, 4, 6, 7 and architecture.md updated. Any Phase 2 work must implement `stateAt()` and the 409 stale-parent check.
- 2026-09-18 — Screenshots go only to the orphan branch `pr_screenshot` via the screenshot-runner subagent (CLAUDE.md rule 8). DT-018 tracks creating/protecting that branch.
- 2026-09-18 — GitHub remote confirmed: `git@github.com:ludaxkris/vibe_motion.git`, default branch `main`.

- 2026-09-17 — Planning artifacts created. Phase 0 has not started. First Phase 0 task is the monorepo scaffold + gates; nothing else should start until Phase 0 merges (see build_plan.md §3).

## Claimed next tasks

Agents claim a task here before creating a worktree so two agents do not pick the same phase task.

| Task | Claimed by | Date |
|---|---|---|
| — | — | — |

## Facts other agents need

- Primary checkout: `/Users/christung/Projects/anthropic/vibe_motion`. Remote `origin` = `ludaxkris/vibe_motion` (private). Worktrees go under `.worktrees/<branch>` (gitignored).
- Long-lived branches: `main` (code), `pr_screenshot` (orphan, screenshots only).
- Kotlin toolchain on this machine: JDK 21. Node 25 is installed; the project targets Node 22 LTS on Render, so use `.nvmrc`/`engines` and do not rely on Node 25-only APIs.
- Render CLI is not installed locally. `render blueprints validate` cannot be run here until it is; validate `render.yaml` against `https://render.com/schema/render.yaml.json` instead.
- Claude Design mocks from Chris are pending. Phase 3 may start with wireframe-level layout and re-skin when they arrive.
