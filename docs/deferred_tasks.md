# Deferred tasks and bugs

Append-only log. Edited directly on `main` in the primary checkout (see CLAUDE.md, "Shared coordination files"). This will migrate to Linear; keep titles issue-ready.

Priority: P0 blocks launch or corrupts data · P1 user-visible defect in a core flow · P2 degraded experience or tech debt with known cost · P3 nice to have.
Urgency: `now` · `this-phase` · `later`.
Status: `open` · `in-progress` · `done` · `wont-do`.

## Deferred tasks

| ID | Type | Title | Priority | Urgency | Phase | Owner | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| DT-001 | feature | Figma file ingestion → functioning web page | P2 | later | post-v0 | — | open | Plugs in as a source adapter in the clone service (architecture.md §7). |
| DT-002 | feature | PNG / image ingestion → functioning web page | P2 | later | post-v0 | — | open | Same adapter seam as DT-001. |
| DT-003 | feature | Real LLM-backed animation agent replacing MockAnimationAgent | P1 | later | post-v0 | — | open | Implement `AnimationAgent` server-side; UI already passes the prompt text. |
| DT-004 | feature | Headless-browser clone mode for JS-rendered pages | P2 | later | post-v0 | — | open | Playwright/Chromium on Render is heavy; evaluate a separate worker service. |
| DT-005 | feature | Opt-in "keep source scripts" clone mode | P3 | later | post-v0 | — | open | v0 strips all `<script>` tags for stability. |
| DT-006 | feature | Editable version labels | P3 | later | 6 | — | open | v0 labels are auto-generated only. |
| DT-007 | feature | Auth, ownership, and sharing of projects | P1 | later | post-v0 | — | open | `owner_id` on projects; project URLs are unguessable UUIDs in v0 but not private. |
| DT-008 | feature | JS / scroll-driven / Web Animations API animations | P2 | later | post-v0 | — | open | Needs `engine` field on catalog entries and a JS emitter in the exporter. |
| DT-009 | feature | Store cloned binary assets (images, fonts) instead of absolutizing URLs | P2 | later | post-v0 | — | open | Requires object storage; v0 keeps one HTML document per project in Postgres. |
| DT-010 | feature | Multi-page projects | P3 | later | post-v0 | — | open | v0: one URL = one project. |
| DT-011 | chore | Migrate this log to Linear | P3 | later | — | Chris | open | Blocked on tooling availability. |
| DT-012 | feature | Persist Control Panel width per browser | P3 | this-phase | 3 | — | open | Open question in build_plan.md §7. |
| DT-013 | feature | Rate limiting on `POST /projects` | P1 | this-phase | 8 | — | open | Clone is the only expensive endpoint. |
| DT-014 | chore | Screenshot-Runner: define exact deliverable | P3 | now | 0 | Chris | open | Role description in the brief was truncated ("Take ..."). Assumed: capture screenshots of running app states for PRs and mock comparison. Confirm. |
| DT-015 | chore | Verify `fromService.envVarKey: RENDER_EXTERNAL_URL` resolves cross-service URLs in render.yaml (web ↔ api) on first Render deploy | P1 | this-phase | 0 | — | open | Render docs confirm envVarKey copies a var from another service; unconfirmed for platform-provided vars. Fallback: `sync: false` and set manually. Affects previews most. |
| DT-016 | feature | Persist unsaved draft state to localStorage as a crash/tab-close safety net | P2 | this-phase | 6 | — | open | v0 has an unsaved indicator and beforeunload warning only. |
| DT-017 | perf | Checkpoint snapshots for version history so `stateAt(N)` does not replay every diff on long histories | P3 | later | post-v0 | — | open | Trigger: a project exceeding ~200 versions. Fold cost is negligible at v0 scale. |
| DT-018 | chore | Protect the `pr_screenshot` branch from deletion and force-push | P2 | this-phase | 0 | Chris | in-progress | Branch created and pushed 2026-09-18 with a README. Remaining: add a branch protection or ruleset in GitHub settings (needs repo admin; may require a paid plan on private repos). |
| DT-019 | feature | "Upgrade to latest catalog" action for saved assignments pinned to an older catalog version | P3 | later | post-v0 | — | open | Explicit user action producing a new version whose diff rewrites `catalogVersion` and remaps params. v0 never auto-upgrades. |

## Bugs

| ID | Type | Title | Priority | Urgency | Phase | Owner | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| — | — | none yet | — | — | — | — | — | — |
