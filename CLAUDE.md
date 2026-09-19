# CLAUDE.md — Vibe Motion

Instructions for every agent (human-driven or autonomous) working in this repository. Read fully before your first change. Project-specific decisions live in [docs/build_plan.md](docs/build_plan.md) and [docs/architecture.md](docs/architecture.md); do not re-decide them in a PR. If you believe a decision is wrong, log it in `docs/deferred_tasks.md` and raise it in your PR description.

## What this project is

Vibe Motion is a web tool that lets product designers add CSS animations to an existing web page: clone the page, click a component, pick or generate an animation, tune it live, keep version history, export HTML/CSS/JS. Stack: Next.js 16 (`apps/web`), Kotlin/Ktor 3 (`apps/api`), Postgres 16, shared animation catalog (`packages/animation-catalog`). Hosted on Render via `render.yaml`.

## Non-negotiable rules

1. **Work in your own git worktree.** Never commit on `main` in the primary checkout, except for the two shared files listed under "Shared coordination files". Create worktrees under `.worktrees/<branch>` (gitignored). One agent per worktree. Branch names: `feat/<phase>-<short-topic>`, `fix/<topic>`, `chore/<topic>`.
2. **Run all gates before marking a PR ready for review.** `pnpm gates` at the repo root runs every gate for web, api, and catalog. A PR with any failing gate must stay in draft. CI applies the `Gate Flag` label to any PR with a red gate; if you see that label on your PR, fix it or explain loudly in the PR description why it cannot be fixed in this PR.
3. **Test-Runner before merge.** The `test-runner` subagent must have run the full suite on the final commit of a PR before it is merged. Paste its summary in the PR.
4. **Log deferred work.** Anything you notice but do not fix goes in `docs/deferred_tasks.md` with priority and urgency (format below). Do not leave TODO comments in code without a matching entry.
5. **Update `memory.md` when you start, finish, or change scope**, and whenever you touch a shared contract (`apps/api/openapi.yaml`, `packages/animation-catalog/schema.json`, the bridge message protocol, Flyway migrations).
6. **Contracts are additive after Phase 0.** You may add endpoints, fields, catalog params, or message types. You may not rename or remove them without a `docs/deferred_tasks.md` entry and a note in `memory.md` that the affected worktrees have been told.
7. **No secrets in the repo.** Secrets are `sync: false` in `render.yaml` and entered in the Render dashboard. Locally use `.env.local` (gitignored). Never print environment values in logs or PR descriptions.
8. **Screenshots never touch working branches.** Screenshot files are committed only to the orphan branch `pr_screenshot` by the `screenshot-runner` subagent and linked from PR comments. Never `git add` a `.png`/`.jpg` on any other branch; `.gitignore` blocks common screenshot paths as a backstop. If you see screenshots in a diff, treat it as a blocking review finding.
9. **Versions are user-initiated diffs.** A version is created only when the user clicks Save. Each version stores a diff from its parent, never full state; full state is materialised by `stateAt()` in the API. Every assignment in a diff carries `catalogVersion`. Live preview edits are a client-side draft and must not call the API.
10. **Clean up after merge.** Once the PR you were reviewing or authoring is merged to `main`, run `scripts/cleanup-merged.sh <branch>` from the primary checkout. It verifies the PR is merged on GitHub, removes the worktree under `.worktrees/<branch>`, deletes the local branch and its remote-tracking ref, and removes the PR's temp files. Then update `memory.md`: mark the worktree entry done (or remove it) and drop the claim. Never clean a branch whose PR is still open; the script refuses to.
11. **Do not ask the user for permission for reversible work.** Do ask before: force-pushing, deleting branches you did not create, editing `render.yaml` database fields (they are immutable on Render), or changing another agent's in-flight files.

## Repository map

```
apps/web/                 Next.js app (editor shell, control panel, help page, bridge client, mock agent)
apps/e2e/                 end-to-end tests for every client (web/ today, mobile/ later), fixtures, the Docker full-stack (docker/)
apps/api/                 Ktor service (clone, versions, export, catalog endpoint), openapi.yaml, Dockerfile, Flyway migrations
packages/animation-catalog/  versions/<semver>.json (immutable), current, schema.json, CHANGELOG.md, type generation, check-immutable gate
docs/                     build_plan.md, architecture.md, user_flow.md, deferred_tasks.md, agents/pr-comment.md
.claude/agents/           subagent definitions (see below)
.github/workflows/        gates.yml (CI)
render.yaml               Render blueprint: web + api + Postgres
memory.md                 shared agent memory (who is doing what, right now)
CLAUDE.md                 this file
```

## Commands

Once Phase 0 lands these are the canonical entry points. Until then, see the phase-0 PR.

```bash
pnpm install                     # JS workspace
pnpm dev                         # web on :3000, expects API on :8080
pnpm gates                       # ALL gates (catalog + web + api + e2e + full-stack Docker e2e); what CI runs
pnpm --filter web test           # vitest
pnpm e2e                         # playwright (apps/e2e), web-only specs against `next dev`
pnpm e2e:docker                  # full-stack e2e: a NEW throwaway Docker stack per run (db + api image + prod web build + fixtures + runner); safe to run concurrently from any worktree; agents run it (and `pnpm gates`) in the background. See apps/e2e/README.md
pnpm --filter animation-catalog validate
scripts/cleanup-merged.sh <branch> # after the PR merges: remove worktree, branch, temp files

cd apps/api && ./gradlew run     # API on :8080, needs DATABASE_URL
cd apps/api && ./gradlew check   # ktlint + kotest (Testcontainers Postgres, needs Docker)
```

Local Postgres: `docker compose up db` (compose file lands in Phase 0).

## Conventions

- **Naming prefix.** Every class, id, keyframe, custom property, or data attribute this tool injects into a cloned page or an export is prefixed `vm-` / `--vm-` / `data-vm-`. No exceptions. Bridge `postMessage` types are the one thing that is not prefixed: they are namespaced by the envelope's `source: "vibe-motion"` (see `docs/plans/phase-4-bridge-protocol.md`).
- **Web.** TypeScript strict. Server Components by default, `"use client"` only where needed (the editor is almost entirely client). State in Zustand (`apps/web/lib/store`), server data via TanStack Query with the generated client in `apps/web/lib/api-client` (regenerate with `pnpm gen:client`, never hand-edit). Tailwind + shadcn/ui. No CSS modules.
- **API.** Kotlin idiomatic, no `!!`. Routes thin, logic in services, persistence behind repository interfaces. kotlinx.serialization for JSON. Every endpoint exists in `openapi.yaml` before it exists in code.
- **Catalog is versioned and immutable.** Never edit a file under `packages/animation-catalog/versions/` that already exists on `main`, not even for a typo. Any change is a new `versions/<semver>.json` (patch: metadata only; minor: new animations, or new params — standard or cssVar-backed — whose default reproduces the previous rendering, which may add `var(--vm-x)` references to keyframes/baseStyles; major: changed rendering at default params, removed animations, renamed or removed params), a `current` bump, and a CHANGELOG entry. CI's `check-immutable` gate fails otherwise, and `pnpm --filter animation-catalog validate` enforces a superset gate within a shared major (no id or param key may be dropped going forward). Every saved assignment pins `catalogVersion`; the runtime and exporter resolve against that pinned version, and CSS is derived from it, never stored. Add a params entry rather than special-casing an animation in code.
- **Tests.** TDD is expected: write the failing test, then the code. Unit tests next to source. e2e lives in its own package, `apps/e2e` (never inside the app under test): deployment-independent web specs in `apps/e2e/web/` (they run under both gates), those that need the MSW mock api or a dev build in `apps/e2e/web/mocked/` (only `pnpm e2e`), those that need the real api in `apps/e2e/web/stack/` (only `pnpm e2e:docker`), fixture pages to clone in `apps/e2e/fixtures/`; a future mobile client gets `apps/e2e/mobile/`. Never point e2e at a shared or long-lived database or at Render. Golden files for the exporter in `apps/api/src/test/resources/golden`.
- **Commits.** Conventional commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`). Small, reviewable PRs, one phase task each. End commit messages with the attribution line the harness provides.
- **PR description template.** What / Why / How to test / Gates output / Deferred items logged / memory.md updated (yes/no).

## Shared coordination files

Two files are edited directly on `main` in the primary checkout (`git -C <primary> commit`), not in worktrees, so that every agent sees the latest immediately:

- `memory.md` — see its header for the entry format. Reconciliation rule: if an entry names a worktree that no longer exists (`git worktree list`), that agent has moved on; mark the entry stale or remove it.
- `docs/deferred_tasks.md` — append-only log of deferred tasks and bugs.

Keep these edits tiny and commit them with `docs(memory): ...` or `docs(deferred): ...`. Pull `main` before editing to avoid conflicts.

## Deferred tasks and bugs format

```
| ID | Type | Title | Priority (P0–P3) | Urgency (now / this-phase / later) | Phase | Owner | Status | Notes |
```

P0 = blocks launch or corrupts data. P1 = user-visible defect in a core flow. P2 = degraded experience or tech debt with a known cost. P3 = nice to have. This log will migrate to Linear; keep titles crisp enough to become issue titles.

## Subagents

Defined in `.claude/agents/`. Use them; do not re-implement their job inline.

| Agent | Model | Use when |
|---|---|---|
| `code-reviewer` | Opus | A PR or branch is ready for review. Runs `/code-review`, reports blocking vs non-blocking. |
| `test-writer` | Sonnet | You need unit, integration, or e2e tests written for a change or a gap. |
| `code-architect` | Fable | A change touches the bridge protocol, data model, clone pipeline, or exporter, or you suspect a performance/scalability problem. |
| `test-runner` | Haiku | Before any merge, and whenever you want the full suite run and summarised. |
| `screenshot-runner` | Haiku | You need screenshots of the running app (editor states, help page, exported page) for a PR or for visual comparison against the Claude Design mocks. It commits them to the `pr_screenshot` branch and posts a PR comment. |

Every subagent posts its report as an upserted comment on the PR (one comment per agent, updated on re-runs; via `scripts/pr-comment.sh`, procedure in `docs/agents/pr-comment.md`), so findings and results live with the code.

Typical PR flow: implement (TDD) → `test-writer` fills gaps → `pnpm gates` → `screenshot-runner` if UI changed → `code-reviewer` → address blocking items → `test-runner` on final commit → mark ready → (after merge) `scripts/cleanup-merged.sh <branch>` + memory.md update.

## Definition of done for a task

- Gates green locally and in CI, no `Gate Flag` label.
- Tests cover the new behaviour (unit at minimum; e2e for any user-visible flow).
- `openapi.yaml` / `schema.json` updated if contracts changed, client regenerated.
- `docs/deferred_tasks.md` has entries for anything skipped.
- `memory.md` entry updated to "done" or removed, with a one-line pointer to the PR.
- After merge: worktree, local branch and temp files removed via `scripts/cleanup-merged.sh`.
- PR description follows the template and includes the Test-Runner summary.
