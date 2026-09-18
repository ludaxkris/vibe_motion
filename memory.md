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
| (primary) | main | Claude Fable 5.1 (planning session with Chris) | planning + 0 | Planning docs (done), Phase 0 foundation PR #1 (merged), agent PR comments + cleanup PR #2 (merged) | done 2026-09-18 | 2026-09-17 | no |
| `.worktrees/feat/2-api-core` | feat/2-api-core | Claude Fable 5.1 (session with Chris) | 2 | Projects + clone service (SSRF guard, jsoup rewrite, data-vm-id), versions (diff, stateAt, 409, 422, restore), page serving | in-progress | 2026-09-18 | additive only if needed; Flyway V2+ only |
| `.worktrees/feat/3-web-shell-help` | feat/3-web-shell-help | Claude Fable 5.1 (session with Chris) | 3 | Web shell: URL entry → POST /projects, resizable split editor, Control Panel state machine + /dev route, live help page via runtime CSS generator, MSW mocks; re-skin from Claude Design mocks | in-progress | 2026-09-18 | no (consumes openapi + catalog read-only) |
| .worktrees/feat/phase-1-catalog | feat/phase-1-catalog | Claude Fable 5.1 (orchestrator + subagents) | 1 | Close Phase 1 exit criteria: cross-language (version, animationId) agreement, catalog 1.1.0 adding `fillMode` standard param | in progress | 2026-09-18 | yes — `schema.json` (additive: `fillMode` standard key), new `versions/1.1.0.json`, `current` bump |

## Notices (newest first)

- 2026-09-18 — **`animation-catalog` package entry points were wrong on `main`** (`main`/`types`/`exports` pointed at `dist/index.js`; the build emits `dist/src/index.js`, so no workspace consumer could import it). Fixed on `feat/3-web-shell-help` (88dde98) in `packages/animation-catalog/package.json`; web now depends on `animation-catalog` (`workspace:*`) with `pre*` hooks that build it. Phase 1 worktree also edits that package.json — expect a small merge conflict; keep the `dist/src/` paths.
- 2026-09-18 — **Phase 1 claimed** (`feat/phase-1-catalog`). Heads-up for Phases 2/3: additive contract change incoming — `schema.json` gains a sixth standard param key `fillMode` (maps to `animation-fill-mode`), catalog `1.1.0` is published and `current` moves to `1.1.0`. `1.0.0` stays untouched and load-only. Do not hardcode the five-key standard set; read it from the catalog package / `CatalogParam.isStandard`.
- 2026-09-18 — **Phase 0 merged (PR #1) and PR #2 merged.** `main` now has the monorepo, gates, CI, frozen `openapi.yaml`, catalog 1.0.0, cleanup script. Contract freeze is in effect: `apps/api/openapi.yaml`, `packages/animation-catalog/schema.json` and `versions/1.0.0.json` are additive-only. **Phases 1, 2, 3 are open for claiming** (one worktree each; claim below before creating the worktree). Worktrees for #1/#2 were removed with `scripts/cleanup-merged.sh`.
- 2026-09-18 — From PR #2 on, every subagent posts its report as a marker-tagged, upserted PR comment (`<!-- vibe-motion-agent:<name> -->`). Procedure: docs/agents/pr-comment.md. Orchestrators still own the PR description.
- 2026-09-18 — PR #1 review fixes pushed (5d9e609). Flyway `V1__baseline.sql` edited in place (dropped a duplicate index) before merge; anyone with a local DB from an earlier run must `docker compose down -v && docker compose up -d db`. After #1 merges, migrations are append-only (V2+). New gate: "generated artifacts up to date" fails if `openapi.yaml` or the catalog change without regenerating; run `pnpm gen:types && pnpm gen:client` after editing either.
- 2026-09-18 — Phase 0 PR #1 open (draft). `apps/api/openapi.yaml` and `packages/animation-catalog/schema.json` + `versions/1.0.0.json` are the Phase 0 freeze: additive-only once merged. Stack actuals: Next.js 16.3 / React 19.2 / Tailwind 4 / shadcn on Base UI (not Radix); Ktor 3.6 / Kotlin 2.4 / Exposed 1.5 (packages `org.jetbrains.exposed.v1.*`) / Flyway 13 / Kotest 5.9. Local Postgres via `docker compose up -d db` is on host port **5433**. Phases 1, 2, 3 may start in separate worktrees after #1 merges.
- 2026-09-18 — Decision from Chris: the animation catalog is **versioned and immutable**. Files under `packages/animation-catalog/versions/` are never edited once on `main`; changes are new files + `current` bump + CHANGELOG. Every saved assignment pins `catalogVersion`. CSS is derived from the pinned entry, never stored. CI gate `check-immutable` enforces it (Phase 1). Adds `catalog_version` column and `GET /catalog/versions`, `GET /catalog/{version}` to the Phase 2 contract.
- 2026-09-18 — Decision change from Chris: versions store **diffs**, created only on explicit user **Save**; live preview never writes to the API. Build plan Phases 2, 4, 6, 7 and architecture.md updated. Any Phase 2 work must implement `stateAt()` and the 409 stale-parent check.
- 2026-09-18 — Screenshots go only to the orphan branch `pr_screenshot` via the screenshot-runner subagent (CLAUDE.md rule 8). DT-018 tracks creating/protecting that branch.
- 2026-09-18 — GitHub remote confirmed: `git@github.com:ludaxkris/vibe_motion.git`, default branch `main`.

- 2026-09-17 — Planning artifacts created. Phase 0 has not started. First Phase 0 task is the monorepo scaffold + gates; nothing else should start until Phase 0 merges (see build_plan.md §3).

## Claimed next tasks

Agents claim a task here before creating a worktree so two agents do not pick the same phase task.

| Task | Claimed by | Date |
|---|---|---|
| Phase 2 — API core (projects, clone service, versions, stateAt, restore) | Claude Fable 5.1 (session with Chris) · worktree `.worktrees/feat/2-api-core` | 2026-09-18 |
| Phase 3 — Web shell + help page | Claude Fable 5.1 (session with Chris) · worktree `.worktrees/feat/3-web-shell-help` | 2026-09-18 |

## Facts other agents need

- Primary checkout: `/Users/christung/Projects/anthropic/vibe_motion`. Remote `origin` = `ludaxkris/vibe_motion` (private). Worktrees go under `.worktrees/<branch>` (gitignored).
- Long-lived branches: `main` (code), `pr_screenshot` (orphan, screenshots only).
- Kotlin toolchain on this machine: JDK 21. Node 25 is installed; the project targets Node 22 LTS on Render, so use `.nvmrc`/`engines` and do not rely on Node 25-only APIs.
- Render CLI is not installed locally. `render blueprints validate` cannot be run here until it is; validate `render.yaml` against `https://render.com/schema/render.yaml.json` instead.
- Claude Design mocks from Chris are pending. Phase 3 may start with wireframe-level layout and re-skin when they arrive.
