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

## Design handoff (applies to Tasks 6–10)

Chris's Claude Design handoff is in `docs/design/` (reference only — never import from it, never copy its JSX verbatim into `apps/web`). Read `docs/design/README.md` fully, then `docs/design/design-system/readme.md` and `docs/design/design-system/tokens/*.css`. Per-component reference: `docs/design/design-system/components/core/<Name>.jsx` + `.prompt.md`. Composed screens: `docs/design/ui_kit/{TopBar,Entry,Editor,Help}.jsx`.

Rule from Chris: **match the handoff pixel-for-pixel; where the handoff and `docs/` conflict, the docs win on behaviour and the handoff wins on visuals**, and every conflict is reported in the task report (the controller logs it in `docs/deferred_tasks.md`). Known rulings:

- Panel is resizable (docs: behaviour) — keep Task 4's split pane; default width renders 320px at 1280 wide (25%); the separator is visually just the panel's 1px `--vm-border` left edge with a wider invisible hit area.
- Entry: on successful clone the docs redirect straight to `/p/<id>`; the handoff's "Cloned" card + "Open in editor →" step is not built.
- Cloning progress: the API is one `POST /projects` with no progress events. Render the handoff's cloning card (spinner, "Cloning <host+path> · N s" with a real elapsed counter, the four step rows, 3px bar) but never fake completion: all four steps show as pending/faint with the first marked active, and the bar is indeterminate.
- Recent projects: there is no list endpoint. Keep the last 8 projects this browser created/opened in `localStorage` key `vm-recent-projects` (`{ id, title, sourceUrl, openedAt }`); meta line shows host + relative time; the whole column is hidden when empty. No "View all".
- Controls render from the catalog's params (catalog is 1.1.0: every entry has `fillMode`; some have `direction`, `iteration`, `distance`, `scale`, etc.). Handoff rows define the look for Duration/Delay/Distance/Scale (slider + NumberField), Easing (select + curve preview), Repeat = `iteration` (dense segmented 1 / 2 / 3 / ∞). Params the handoff does not mock (`fillMode`, `direction`, other `select` types) use the dense segmented style when ≤4 options, else the easing-style select. Slider ranges come from the catalog's min/max/step, not the handoff's numbers.
- Tabs are Animate · History · Export (handoff) — replaces the earlier Animation/Versions tabs. History and Export bodies are Phase 6/7: render the tab with a single muted caption ("Saved versions appear here. A version is only created when you click Save." / "Export arrives with Phase 7.").
- Glyphs are the handoff's unicode set (✦ ↻ ‹ ▾ ⌕ › ✓ ∞ !), `aria-hidden`, with real accessible names on the controls. No emoji, no new icon usage.
- Light theme only; remove dark-mode token blocks (dark theme is DT-051). No webfonts: remove `next/font` usage, use the token font stacks.
- Keep every role, label, `data-testid`, store contract and behaviour from Tasks 3–5 unless a bullet here or in the task says otherwise; update tests whose copy changes.

## Task 6: Design tokens and core primitives

- `app/globals.css`: bring in every custom property from `docs/design/design-system/tokens/{colors,typography,spacing,motion}.css` verbatim (names and values), light only. Point the shadcn semantic variables (`--background`, `--foreground`, `--card`, `--primary`, `--muted`, `--border`, `--input`, `--ring`, `--destructive`, `--radius`, …) at them so existing `components/ui/*` inherit the palette, and expose the tokens to Tailwind 4 via `@theme inline` (colours `vm-*`, font families, the type scale 10/11/12/13/15/34/48, radii 4/6/8/10/12/14/pill, shadows sheet/card/raised/popover/modal/accent, `--focus-ring`, durations/easings). Body: `--vm-canvas` background, `--vm-ink`, 13px/1.4 system sans. `app/layout.tsx`: drop `next/font`, drop any Phase 0 header/nav chrome (the TopBar replaces it).
- Primitives in `components/ui/`, each matching its reference (`docs/design/design-system/components/core/<Name>.jsx` + `.prompt.md`) and built on the existing shadcn/Base UI primitive where one exists: `button.tsx` (variants primary / secondary / ink / bar-primary / bar-outline / danger-link / link; heights 28/30/36/40/44; primary has the accent glow only where the handoff shows it; disabled = 40% opacity; no press scale), `input.tsx` (sizes sm 34 / md / xl 44, optional prefix slot, error state 1.5px danger border + glow), `number-field.tsx` (62×28, mono, unit in faint ink, commits on blur/Enter, clamps to min/max, ArrowUp/Down step), `slider.tsx` (4px track, accent fill, 14px thumb with 1.5px accent ring), `segmented.tsx` (radiogroup semantics; normal + dense), `tabs.tsx` folder-tab variant, `chip.tsx` (toggle, `aria-pressed`), `element-tag.tsx`, `section-label.tsx` (11px/600 uppercase +0.04em), `dialog.tsx` styling (14px radius, modal shadow, scrim), `toast.tsx` (bottom-centre black pill, slides up 8px over 250ms, auto-dismiss ~2s, `role="status"`), and `components/top-bar.tsx` (44px bar; slots: wordmark, optional context (title text + chip), right-side actions) per `ui_kit/TopBar.jsx`.
- Focus-visible everywhere = `--focus-ring`; transitions use `--dur-fast`/`--dur-base` and respect `prefers-reduced-motion`.

Tests: RTL per primitive for behaviour (NumberField commit/clamp/step, Segmented radio semantics + arrow keys, Chip pressed, Toast auto-dismiss with fake timers, Button renders each variant's token classes, TopBar slots). A `globals.css` test asserts every custom property name in the four token files is present with the same value. Whole existing suite stays green.

## Task 7: Entry screen to the handoff

Re-skin `/` per README "1. Entry" and `ui_kit/Entry.jsx`, keeping Task 3's behaviour (validation, normalisation, pending, error mapping, redirect).

- TopBar variant: wordmark left, "Help ↗" right (opens `/help` in a new tab).
- Grid `1.35fr 1fr`, gap 56, padding `36px 120px 60px`. Headline two lines; URL row = Input xl with `https://` prefix (the field holds the rest; pasting a full URL strips the scheme into the prefix; `http://` stays possible by typing it) + Clone button (ink, 44px).
- Cloning state (`3a`) and error state (`3b`) per the handoff and the rulings above; button reads "Retry" after an error; the "other reasons" card lists Unreachable · Too large · Blocked host · Not HTML; map API error codes to the matching bold sentence where the contract has one (read `openapi.yaml` for codes; 413/429 get their own sentences). "Cancel" during cloning aborts the request (AbortController) and returns to the idle form with the URL kept.
- Recent projects per the ruling: `lib/recent-projects.ts` (pure read/write helpers, tolerant of bad JSON, cap 8, most recent first) written on successful clone and whenever the editor loads a project; column at 50% opacity while cloning.

Tests: existing Task 3 tests adapted; prefix/paste handling; cancel aborts and never navigates; each error code → message; recent-projects helpers + rendering + hidden-when-empty. e2e: smoke flow still lands on `/p/<id>`, and returning to `/` lists the project under Recent projects.

## Task 8: Editor chrome and Control Panel to the handoff

Re-skin `/p/[projectId]` per README "Global chrome", "2. Editor" and `ui_kit/Editor.jsx`.

- TopBar: wordmark · divider · project host+path · version chip (`v<seq>` of the current version, from the project/versions query) · unsaved dot + "Unsaved" when dirty. Right: Help · Cancel · Save (40% opacity and disabled when clean). Cancel reverts the draft to `currentVersionState` (add a store action `revertDraft()`; panel state follows the handoff rule: tuning if the selected element still has an assignment, else selected). Save stays inert in this phase (opens nothing; Phase 6) but is enabled-looking only when dirty.
- Canvas + sheet: preview padding `16px 16px 0`, white sheet radii `10px 10px 0 0`, `--shadow-sheet`; iframe never tinted. Panel: `--vm-panel`, folder tabs, one white card with 14px-padded sections split by `--vm-divider`, bottom caption.
- Panel states per the handoff: **idle** (dashed square, copy, Esc kbd chip; WHOLE PAGE section with the prompt textarea and a disabled "✦ Auto-generate for this page" + caption noting it arrives with the mock agent; "ANIMATED · n" rows from `draftState` — clicking a row dispatches SELECT for that vmId — and a disabled "↻ Replay all"), **selected** (ElementTag + text, "No animation yet · Esc to deselect", disabled primary "✦ Auto-generate for this element", secondary "Choose custom animation"), **choosing** (44px header with ‹ back, search Input sm with ⌕, category chips, 2-col AnimationCard grid whose demo block plays the real keyframes on hover/focus via `lib/runtime-css`, applied card highlighted, empty-search copy, footer caption; ↑↓ moves the highlight, Enter applies), **tuning** (tag + name + "Change" link, TRIGGER segmented limited to `entry.triggers`, param rows per the rulings, easing select with the 62px curve preview, "↻ Replay" disabled until the bridge exists, "Remove animation" danger link).
- Esc dispatches DESELECT when the draft is clean.
- The element tag text comes from the machine's `vmId` until the bridge supplies tag/text (Phase 4): show the `vmId` in the ElementTag.

Tests: adapt Task 4/5 component tests to the new copy/structure; Cancel reverts and lands in the right state; Esc rule; picker keyboard nav; param rows render the right control per param type for at least one entry with `distance`, one with `scale`, one with `direction`. e2e: editor smoke still passes.

## Task 9: Dialogs, toast wiring and the /dev route

- `components/dialogs/unsaved-guard-dialog.tsx` and `components/dialogs/save-dialog.tsx` per README "3. Dialogs & toast" — presentational, fully controlled by props (`open`, element/animation names, version numbers, change list, callbacks); change rows show sign (+ / ~ / −) with diff colours, ElementTag, name, meta. `lib/diff-summary.ts`: pure `summariseDiff(current, draft, catalogLookup)` → rows + the auto label ("Fade In Up on vm-3, removed Pulse on vm-9"), used by the Save dialog preview. No API calls; Phase 6 wires them.
- `/dev` (index) replaces `/dev/panel` (redirect the old path): renders every panel state (idle empty, idle with assignments, selected, choosing, choosing with empty search, tuning for an entry with `distance` and one with `scale`), both dialogs (open, inline-rendered rather than portalled over each other), the toast, and the Entry cloning + error states, each in a labelled frame at its real width (panel 320px). Still 404 in production.

Tests: `summariseDiff` table (add / change / remove / no-op / label text); dialogs render their props and fire callbacks; `/dev` renders every frame; production 404.

## Task 10: Help page to the handoff with live demos

`/help` per README "4. Help" and `ui_kit/Help.jsx`, driven by the **current** catalog (version chip and counts are real: 1.1.0, 26 entries — not the handoff's stale numbers).

- TopBar variant: wordmark · divider · "Animations" · `catalog <version>` chip.
- Toolbar: category chips with counts (All n · each category present), search (240px), "↻ Replay all". Sections per category: title 15/600 + one-line blurb; 4-col grid, gap 14; cards per the handoff (120px demo box, 64×38 accent block, ↻ mini button, name 13/600, defaults line in mono 11 muted from the entry's params, e.g. "600ms · ease-out · distance 24px").
- `app/help/page.tsx` stays a Server Component and emits one `<style id="vm-runtime">` from `runtimeStylesheet` for all current entries; the client card sets the block's inline style from `assignmentStyle(entry, CURRENT_VERSION)`. Replay sets `animation-name: none` and restores it on the next frame. Entries whose `defaultTrigger` is `hover` play on hover/focus of the demo box (hint "Hover to play"); others play on mount and on replay. Infinite-iteration entries run until replayed/unmounted.
- `prefers-reduced-motion: reduce`: nothing autoplays; ↻ still plays (explicit action); a one-line note under the toolbar says so.
- Keep `data-testid="catalog-card"`.

Tests: one card per current entry; block carries `animation-name` = `keyframesName(...)`; replay toggles to `none` and back; chips + search filter and counts; reduced-motion suppresses autoplay; defaults line formatting. e2e: `/help` shows 26 cards, `#vm-runtime` exists, first block's computed `animation-name` starts with `vm-`.
