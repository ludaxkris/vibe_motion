# Phase 3 — Web shell and help page: implementation plan

Spec: [docs/build_plan.md](../build_plan.md) §4 "Phase 3", plus [docs/architecture.md](../architecture.md) and [docs/user_flow.md](../user_flow.md). The spec wins over this plan.

Branch `feat/3-web-shell-help`, worktree `.worktrees/feat/3-web-shell-help`. All work is in `apps/web` unless stated.

## Global Constraints

- Read the repo-root `CLAUDE.md` before the first change; its rules bind every task.
- TDD: failing test first, then code. Unit tests sit next to source (`foo.ts` → `foo.test.ts`). e2e in `apps/web/e2e`.
- TypeScript strict. Server Components by default; `"use client"` only where needed. Zustand in `apps/web/lib/store`, server data via TanStack Query with the generated client in `apps/web/lib/api-client` (never hand-edit `schema.d.ts`). Tailwind + shadcn/ui (Base UI, not Radix). No CSS modules.
- Contracts are read-only in this phase: do not edit `apps/api/openapi.yaml`, `packages/animation-catalog/schema.json`, or anything under `packages/animation-catalog/versions/`.
- Everything injected into a page or generated as CSS is prefixed `vm-` / `--vm-` / `data-vm-`.
- Live preview edits are a client-side draft and must never call the API. Nothing in this phase calls `POST /projects/{id}/versions`.
- Every saved/draft assignment carries `catalogVersion`. CSS is derived from the catalog entry + params, never stored.
- Only `apps/web/lib/env.ts` reads `process.env`.
- No `.png`/`.jpg` committed. No secrets. No TODO comment without a `docs/deferred_tasks.md` entry (report deferred items in your task report; the controller logs them on `main`).
- Conventional commits, each ending with `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.
- Before reporting DONE run, from the worktree root: `pnpm --filter web lint && pnpm --filter web typecheck && pnpm --filter web test`. Tasks that touch e2e also run `pnpm --filter web e2e`.
- Visual design: tasks 1–6 build wireframe-level UI with existing shadcn components and semantic tokens from `app/globals.css` only (no hard-coded colours, no new fonts), so Task 7 can re-skin by changing tokens and component classes rather than structure.

## Task 1: Runtime CSS generator

Create `apps/web/lib/runtime-css/index.ts` (+ `index.test.ts`): the single pure module that turns `(catalog entry, catalogVersion, params, trigger)` into CSS. The help page uses it now; the bridge (Phase 4) and the draft store reuse it later.

- `resolveParams(entry, params?)` → every catalog param key mapped to the given value or the catalog `default`. Unknown keys are dropped.
- `keyframesCss(entry, catalogVersion)` → `@keyframes <name> { <entry.keyframes> }` where `<name>` is `keyframesName(entry.id, catalogVersion)` from the `animation-catalog` package (`vm-<id>-v<major>`).
- `assignmentStyle(entry, catalogVersion, params?)` → a flat `Record<string, string>` of CSS property → value: `animation-name`, plus the standard `animation-*` longhand for every param of type `duration`/`easing`/`iteration`/`direction` and any fill-mode param the catalog declares, plus one `--vm-*` custom property for each param that has a `cssVar`. Inspect `packages/animation-catalog/versions/1.0.0.json` and `schema.json` for the exact param keys in use and map each; a param with neither a standard mapping nor a `cssVar` is a test failure, not a silent skip.
- `runtimeStylesheet(pairs)` → de-duplicated keyframes CSS for a list of `(entry, catalogVersion)` pairs (one block per distinct keyframes name).
- Add `animation-catalog` as a `workspace:*` dependency of `web` if it is not resolvable already, and make `apps/web/lib/catalog.ts` re-export from the package (`CATALOGS`, `CURRENT_VERSION`, `getCatalog`, `getEntry`) instead of importing the JSON by relative path and hard-coding `"1.0.0"`. Keep its existing exported function names working.

Tests: for every entry of every version in `CATALOGS`: `keyframesCss` output parses (use a CSS parser already in the workspace or add `postcss` as a devDependency), `assignmentStyle` with no params covers every param, overriding one param changes exactly that property, keyframe names are `vm-` prefixed and every custom property is `--vm-` prefixed. `runtimeStylesheet` de-duplicates.

## Task 2: MSW mock API

Add `msw` and implement the OpenAPI contract as mocks in `apps/web/mocks/`.

- `handlers.ts`: handlers for every path in `apps/api/openapi.yaml` (`/health`, `/catalog`, `/catalog/versions`, `/catalog/{version}`, `/projects`, `/projects/{projectId}`, `/projects/{projectId}/page`, versions list/create, `/state`, `/restore`, `/export`), typed against `lib/api-client/schema.d.ts` so a contract change breaks typecheck. In-memory store in `db.ts` with a `resetDb()`.
  - `POST /projects`: invalid/non-http(s) URL → the contract's validation error; a URL whose host is `unreachable.test` → the contract's clone-failure error; otherwise creates a project + version 0 (empty diff) and returns it.
  - `GET /projects/{id}/page`: returns a fixture HTML document (`mocks/fixtures/page.html`) with `data-vm-id` on every element, containing a heading, paragraph, image placeholder (inline SVG/data URI, no binary files), button and card. Unknown id → 404.
  - Versions: implement the diff fold (`set` then `remove`) for `/state`, 409 on stale `parentVersionId`, restore appends a new version. Catalog endpoints serve from the `animation-catalog` package.
- `server.ts` (msw/node) wired into `vitest.setup.ts` (`listen` with `onUnhandledRequest: "error"`, `resetHandlers` + `resetDb` after each).
- `browser.ts` + generated `public/mockServiceWorker.js`; a client component `mocks/MockProvider.tsx` mounted in `app/providers.tsx` that starts the worker and delays rendering children until it is ready, only when `env.apiMocking` is true. Add `apiMocking: process.env.NEXT_PUBLIC_API_MOCKING === "enabled"` to `lib/env.ts`. Playwright's `webServer` sets `NEXT_PUBLIC_API_MOCKING=enabled`. The worker must never start in a production build without the flag.
- Note: the iframe `src` points at `env.apiOrigin`; a service worker only intercepts same-origin navigations. When mocking is on, expose `previewPageUrl(projectId)` in `lib/preview-url.ts` that returns a same-origin Next route `app/mock-api/projects/[projectId]/page/route.ts` serving the same fixture (404 for unknown is not required there), and `${env.apiOrigin}/projects/{id}/page` otherwise. The mock route returns 404 when `env.apiMocking` is false.

Tests: handler tests through `apiClient` (create → get → versions → state fold → 409 → restore; invalid URL; clone failure; page 404). `previewPageUrl` both modes.

## Task 3: URL entry screen

Make `/` functional. Extract a client component `components/url-entry-form.tsx`; `app/page.tsx` stays a Server Component.

- Submit → `useMutation` calling `apiClient.POST("/projects", { body: { url } })` → on success `router.push(/p/<id>)`.
- Client-side validation: non-empty, parses as `http:`/`https:` URL; error announced via `aria-describedby` + `role="alert"`. A bare host like `example.com` is normalised to `https://example.com`.
- Pending state: button disabled, label "Cloning…", input read-only. After 5 s pending show the hint "Still cloning — large pages can take up to 15 seconds." (build plan risk: cold starts).
- API errors: map validation error, clone failure and network failure to distinct human messages; the form stays filled in so the user can retry.
- Remove the Phase 0 "not wired up yet" hint. Keep the link to `/help`.

Tests (RTL + MSW): happy path pushes to `/p/<id>`; invalid input never calls the API; clone failure and network failure messages; pending state. Update `e2e/smoke.spec.ts`: button is enabled, submitting `https://example.com` lands on `/p/<id>`.

## Task 4: Editor shell with resizable split

`/p/[projectId]`: load the project, host the iframe, resizable split.

- `components/editor/editor-shell.tsx` (client): `useQuery` for `GET /projects/{projectId}`; states: loading skeleton, not-found (404 → message + link to `/`), error with retry, loaded.
- Loaded: header strip with project title, source URL, a disabled "Save" button and an "unsaved changes" indicator bound to `unsaved` from the store (always clean in this phase); preview `<iframe title="Cloned page preview" src={previewPageUrl(projectId)} sandbox="allow-same-origin">`; the existing `ControlPanel` on the right.
- `components/editor/split-pane.tsx`: two panes and a `role="separator"` handle (`aria-orientation="vertical"`, `aria-valuemin=20`, `aria-valuemax=30`, `aria-valuenow`). Panel width is a percentage of the container, default 25, clamped to [20, 30]. Pointer drag (pointer capture; while dragging, the iframe gets `pointer-events: none` so it cannot swallow the move events) and keyboard (ArrowLeft/ArrowRight ±1, Home → 30, End → 20). Pure helper `clampPanelWidth(pct)` with its own tests.
- Width persists per browser in `localStorage` key `vm-panel-width`, read after mount (no hydration mismatch), invalid stored values ignored.
- Reset the editor store when `projectId` changes.

Tests: clamp helper; keyboard resize + clamping; persisted value restored and clamped; loading / 404 / error / loaded states via MSW. e2e: from `/`, create a project, editor shows the iframe with the fixture heading and the Control Panel; separator responds to keyboard.

## Task 5: Control Panel state machine and /dev route

Encode the panel as an explicit, hand-written reducer (no XState dependency).

- `lib/store/panel-machine.ts`: states `idle` | `selected { vmId }` | `choosing { vmId }` | `tuning { vmId, animationId }`. Events: `SELECT(vmId)`, `DESELECT`, `CHOOSE_CUSTOM`, `PICK(animationId)`, `BACK`, `CLEAR`. `transition(state, event)` is pure and total: invalid events return the same state. `SELECT` of a different element from any state → `selected`; `SELECT` of an element that already has a draft assignment → `tuning`. `BACK`: tuning → choosing → selected. `tuning` is unreachable without an `animationId` (the type makes it unrepresentable).
- Integrate into `lib/store/index.ts`: `panel` state + `dispatchPanel(event)`; keep `selectedVmId` as a derived selector so existing readers work. Add draft actions `setDraftAssignment(vmId, assignment)`, `updateDraftParam(vmId, key, value)`, `removeDraftAssignment(vmId)`; `unsaved` is derived from deep inequality of `draftState` vs `currentVersionState`. `PICK` creates the draft assignment with catalog defaults, `catalogVersion: CURRENT_VERSION` and the entry's `defaultTrigger`. No action calls the API.
- `components/control-panel/`: split the panel into one component per state. `idle`: prompt. `selected`: element summary + "Generate" (disabled, tooltip "Arrives in Phase 5") and "Custom" buttons. `choosing`: current-catalog list grouped by category with a text filter. `tuning`: one control per catalog param rendered from `param.type` (duration/length/number/angle/percentage → slider + value using min/max/step; easing/direction/select/iteration → select; color → color input), trigger select limited to `entry.triggers`, Back and Remove buttons. Controls write to the draft only. Keep the Animation/Versions tabs and the Help link.
- `app/dev/panel/page.tsx`: renders the panel in each of the four states side by side with a fixed fake `vmId`, plus buttons to fire each event against a live instance. Returns `notFound()` when `process.env.NODE_ENV === "production"` — read through `lib/env.ts` (`env.isProduction`).

Tests: exhaustive transition table (every state × every event); store: PICK creates a defaulted pinned assignment, param update flips `unsaved`, removing restores clean; RTL for each state component; `/dev/panel` renders all four. No network request is made in any of these tests (MSW `onUnhandledRequest: "error"` proves it).

## Task 6: Help page live demos

`/help` renders every entry of the current catalog as a live card using Task 1's generator.

- `app/help/page.tsx` stays a Server Component; it emits one `<style id="vm-runtime">` with `runtimeStylesheet` for all current entries and renders `components/help/animation-card.tsx` (client) per entry.
- Card: name, category badge, description, a stage with a sample box whose inline style is `assignmentStyle(entry, CURRENT_VERSION)`, a "Replay" button (sets `animation-name: none`, restores on the next animation frame), default params as a definition list, triggers. Entries whose `defaultTrigger` is `hover` play on hover/focus of the stage instead of on mount, with the hint "Hover to play"; `in-view`/`load` play on mount and on Replay.
- `prefers-reduced-motion: reduce`: animations do not autoplay; Replay still works (explicit user action) and a page-level note says so.
- Category filter (All + each category present) as a toolbar of toggle buttons with `aria-pressed`; count reflects the filter. Header states the catalog version and total.
- Keep `data-testid="catalog-card"`.

Tests: renders one card per current entry; sample box carries `animation-name` = `keyframesName(...)`; Replay toggles to `none` and back; filter narrows; reduced-motion suppresses autoplay. e2e: `/help` shows 26 cards, the `#vm-runtime` style exists, and a computed `animation-name` on the first sample box starts with `vm-`.

## Task 7: Apply the Claude Design system and mocks

Blocked until Chris's Claude Design export is present in `<primary checkout>/design-handoff/` (gitignored, never committed). Controller writes the detailed brief for this task once the export has been read.

- Map the design system's tokens (colour, type scale, radius, spacing, shadow, motion) onto the CSS custom properties in `app/globals.css` and the shadcn theme; fonts via `next/font`.
- Re-skin `/`, `/p/[projectId]`, the four Control Panel states, and `/help` to match the mocks. Structure, behaviour, roles, labels and test ids from tasks 3–6 stay; if a mock contradicts a behaviour in this plan, report it rather than deciding.
- No image files committed; icons via `lucide-react` or inline SVG.
- All unit and e2e tests still pass; `screenshot-runner` captures each screen for comparison against the mocks.
