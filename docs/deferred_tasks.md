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
| DT-020 | tech-debt | `apps/web/lib/catalog.ts` hardcodes `CURRENT_CATALOG_VERSION` and the 1.0.0 import path; must be bumped by hand on a catalog release | P2 | this-phase | 3 | — | open | Phase 3 should import from `animation-catalog` (CATALOGS/CURRENT_VERSION) or read `GET /catalog`. The web test now reads `packages/animation-catalog/current`, so a pointer bump without a web update fails the web unit gate. Still should import from `animation-catalog` in Phase 3. |
| DT-021 | feature | MSW handlers implementing openapi.yaml so the web shell is clickable without the API | P2 | this-phase | 3 | — | open | Planned in build_plan Phase 3. |
| DT-022 | feature | Draggable Control Panel resizer clamped 20–30% | P3 | this-phase | 3 | — | open | Phase 0 uses CSS `clamp(20%, 25%, 30%)`. |
| DT-023 | chore | Upgrade Kotest 5.9 → 6.x | P3 | later | — | — | open | Brief pinned 5.x; 6.2.5 is current stable. |
| DT-024 | perf | API Docker image is 547 MB; evaluate jlink or alpine JRE base | P3 | later | 8 | — | open | Starter plan pulls this on every deploy. |
| DT-025 | chore | Root `pnpm-workspace.yaml` `onlyBuiltDependencies` list needs revisiting when deps change | P3 | later | — | — | open | Added esbuild, unrs-resolver, sharp to silence pnpm 10 build-script prompts. |
| DT-026 | tech-debt | Web Zustand store is a module-scope singleton, shared across requests during SSR | P2 | this-phase | 4 | — | open | Harmless while nothing writes during render; Phase 4/5 populate per-user draft state. Use a context-based store factory like the QueryClient in providers.tsx. |
| DT-027 | test | Playwright e2e runs against `next dev`, not the production build Render serves | P3 | later | 8 | — | open | Add a CI variant running against `next build && next start`. |
| DT-028 | chore | Add a Flyway V2 discipline note: V1 baseline was edited in place before merge; local DBs migrated earlier need `docker compose down -v` | P3 | now | 0 | — | done | One-time; after PR #1 merges, migrations are append-only. |
| DT-029 | bug-risk | `requireWebOrigin` returns WEB_ORIGIN verbatim; a mixed-case host may not match the lowercased browser `Origin` in CORS | P3 | later | 2 | — | open | Normalise scheme + host to lowercase and drop the path. Low confidence Ktor does not already normalise. |
| DT-030 | chore | `scripts/check-generated.mjs` header says it leaves the tree untouched; on failure it intentionally leaves regenerated files in place | P3 | later | — | — | open | Two-word comment fix; also re-add `**/coverage`, `**/test-results`, `**/playwright-report` to root .dockerignore. |
| DT-031 | test | MSW mock `DELETE /projects/{projectId}` handler has no unit test | P3 | later | 3 | — | open | Two-line handler used only for e2e cleanup (apps/web/mocks). |
| DT-032 | tech-debt | MSW mock 422 validation checks catalogVersion/animationId/param keys but not param values | P3 | later | 3 | — | open | Real API validates more; tighten if UI work starts relying on the mock to catch malformed params. |
| DT-033 | tech-debt | MSW mock `/export` output is not golden-matched against the Kotlin exporter | P3 | later | 7 | — | open | Do not assume byte-identical mock/real export CSS; align when Phase 7 lands. |
| DT-034 | tech-debt | `catalogResources` Gradle task writes `versions.txt` in lexical, not semver, order | P3 | later | 1 | — | open | `apps/api/build.gradle.kts` uses `.sorted()`. Harmless today because `ClasspathCatalogRepository` re-sorts with `SEMVER_ORDER`; would misorder `1.10.0` vs `1.9.0` for anything reading the file order directly. Found in PR #3 review. |
| DT-035 | feature | Catalog: back-fill `iteration` and `direction` standard params onto every entry (new minor catalog version) | P2 | this-phase | 1 | — | open | build_plan §4 Phase 1 "Common params" says every animation exposes duration, delay, easing, iteration, direction, fill-mode. Catalog 1.1.0 (PR #3) added `fillMode` everywhere but left 12 of 26 entries without `iteration` and all but `spin` without `direction`. Deliberate deviation: one-shot entrance/hover entries gain little. Needs Chris's call: ship a 1.2.0 that back-fills, or amend the plan. Raised in PR #3 description. |
| DT-039 | security | DNS-rebinding TOCTOU: the JDK HTTP client re-resolves the host at connect time, after the SSRF guard vetted it | P2 | this-phase | 8 | — | open | Fix needs a connect path pinned to the vetted InetAddress (custom connector) or an egress proxy with the same rules. Documented in SsrfGuard KDoc. Mitigated today by guard-per-hop and no proxy. |
| DT-040 | perf | Clone heap cost on the Render starter plan: one 10 MB page costs ~30 MB+ transient heap; concurrent POST /projects multiply it | P2 | this-phase | 8 | — | open | Add a concurrency limit (semaphore) on clone alongside the DT-013 rate limit, or lower CLONE_MAX_BYTES. |
| DT-041 | bug | Inlining an `@import` can push later un-fetched `@import` rules out of legal position so browsers drop them | P3 | later | — | — | open | Hoist remaining @import rules to the top of the inlined block. |
| DT-042 | bug | `srcset` containing a `data:` URI is left unrewritten, so relative candidates beside it stay relative | P3 | later | — | — | open | Comma-splitting is unsafe with base64 payloads. |
| DT-043 | feature | Modern `@import layer(...)` / `supports(...)` syntax is neither inlined nor absolutised | P3 | later | — | — | open | |
| DT-044 | perf | Stylesheets are not de-duplicated within a clone; the same sheet linked twice is fetched twice and spends budget twice | P3 | later | — | — | open | |
| DT-045 | polish | A neutralised `url(javascript:...)` leaves a stray `)`; the declaration is dropped by browsers but looks odd in exports | P3 | later | 7 | — | open | Revisit when the exporter lands. |
| DT-046 | perf | `GET /projects/{id}/versions` returns the full diff of every version; add a summary projection for long histories | P3 | later | 6 | — | open | Sibling of DT-017. |

## Bugs

| ID | Type | Title | Priority | Urgency | Phase | Owner | Status | Notes |
|---|---|---|---|---|---|---|---|---|
| — | — | none yet | — | — | — | — | — | — |
