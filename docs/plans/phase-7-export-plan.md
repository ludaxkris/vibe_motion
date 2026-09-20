# Phase 7 — Export: design and implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax. Read `CLAUDE.md` first; it is binding.

Status: DRAFT for review, revised after `code-architect` review · Owner: Chris Tung · Written 2026-09-20 against `main` @ 7c08da7. Phase 5 Track B (PR #21) and Phase 6 (PR #22) are open and unmerged.

**Goal:** A designer opens the Export tab on a saved version and gets `index.html`, `vibe-motion.css` and (only when needed) `vibe-motion.js` that reproduce what the preview showed, as copyable text and as a zip; or a CSS snippet for one element.

**Architecture:** The export is a pure function in the API: `base_html` + `stateAt(versionId)` + each assignment's pinned catalog entry → `ExportBundle`. CSS is derived, never stored. The web app only displays, copies and zips the bundle. A generated parity fixture keeps the Kotlin CSS emitter and the TypeScript preview generator (`apps/web/lib/runtime-css`) in agreement for every published `(catalogVersion, animationId)`.

**Tech stack:** Kotlin / Ktor 3 / jsoup 1.21 / Kotest (goldens, property tests), Next.js 16 / TanStack Query / `fflate`, Playwright.

**Contract:** `GET /projects/{projectId}/export` and `ExportBundle` already exist in `apps/api/openapi.yaml` (frozen in Phase 0) and in the generated web client. **This phase changes no contract.**

## Why this can start before Phases 5B and 6 merge

The exporter's inputs are already final: `base_html` (immutable per project), `StateMath.stateAt` (Phase 2), the immutable catalog, and `keyframesName()` (DT-047). Phase 6 is web UI and states "no contract change". Tracks A and B below are scoped to avoid every file PR #21 and PR #22 edit. Checked against both PRs' file lists: besides `lib/store/*`, `control-panel/*`, `editor-shell.tsx`, `lib/bridge`, `lib/versions` and `components/history`, that also rules out `apps/web/mocks/db.ts` and `handlers.test.ts` (PR #22), `apps/web/app/dev/dev-gallery.tsx` and its test (both PRs), `apps/e2e/web/stack/helpers.ts` and `apps/e2e/fixtures/marketing.html` (PR #21 creates/edits them). Neither PR touches `apps/web/package.json`, `scripts/check-generated.mjs`, `apps/api` or `packages/bridge`. Track C, which mounts the tab and aligns the mock, waits for both.

## Owner decisions already made (Chris, 2026-09-20)

1. The zip is built client-side (`fflate`); the API returns text only.
2. The `hover` trigger exports as plain CSS `:hover`, no JavaScript.
3. From the bridge spec §9 (2026-09-18): `in-view` is held on its first keyframe until it fires and plays once in the export; the export respects `prefers-reduced-motion`; no `!important` in exported CSS.

## 1. What the export looks like (the spec)

### 1.1 Files

| Mode | `files[]` (in order) | `html` | `css` | `js` |
|---|---|---|---|---|
| `full` | `index.html`, `vibe-motion.css`, then `vibe-motion.js` only if some assignment uses `in-view` | rewritten page | whole stylesheet | script or `null` |
| `snippet` | `vibe-motion.css`, then `vibe-motion.js` only if that assignment uses `in-view` | `null` | that element's keyframes and rules | script or `null` |

These names are the build plan's and the design handoff's. The MSW mock currently says `styles.css` / `script.js` / `snippet.css`; Track C aligns it (PR #22 edits that file). The client-side zip adds a `README.txt` and is named `vibe-motion-<slug>-v<seq>.zip`.

### 1.2 Class allocation

The class is derived from the element id: `vmId` `vm-17` → class `vm-a17`. It is stable across versions, so a snippet pasted into a site last month still matches a full export made today, and no allocation table is needed. An element with an `in-view` assignment also gets the fixed marker class `vm-in-view`.

### 1.3 HTML (`full` mode)

- Every `data-vm-id` attribute is removed. An element with an assignment gets `vm-aN` **appended** to its `class` (created when absent; existing tokens and their order untouched).
- `<link rel="stylesheet" href="vibe-motion.css">` is added as the last child of `<head>`; when `js` is non-null, `<script src="vibe-motion.js"></script>` follows it, **not deferred** (see §1.5 and question 4). No bridge script and no CSP meta are present to remove: both are added at serve time, never stored.
- **Round trip: jsoup, unconditionally.** Parse `base_html` with jsoup and serialise with the same output settings the clone pipeline used (`prettyPrint(false)`, UTF-8). Order: parse → map `data-vm-id` to classes → `HtmlSanitiser` → insert the link and script → serialise. Byte identity with `base_html` is *not* a requirement: jsoup is not idempotent on its own output in general (`<plaintext>` re-escapes, `<pre>` loses a leading newline, a nested `<form>` is dropped on a second parse, and `<math><mtext><mglyph><style><img …>` is text on the first parse and an element on the second, the mXSS class of bug). That is exactly why the document must be re-parsed and re-sanitised rather than string-patched: a string pass would hand those bytes to a browser with no CSP. `data-vm-id` travels on the element, so the class mapping survives any tree shift.
- **Trust boundary (DT-073):** the preview serves `base_html` under a CSP; an export has none. Task A0 extracts a base-free `HtmlSanitiser` from `HtmlRewriter` (no URL resolution, no stylesheet inlining, no id assignment): `<noscript>` unwrap, comments, removed tags, meta/link removals, SMIL, `on*` handlers, `ping`, dangerous navigation URLs, dangerous `url()` in `style` attributes and `<style>` blocks, form normalisation, and every `data-vm-*` attribute. The clone path calls it too, and the clone goldens must not change. A row cloned by an older rewriter is therefore exported with today's protections.
- **Memory:** measured 130–310 ms and about 76 MB of DOM for a 10 MB, 75k-element document; peak per full export about 115–145 MB against a ~384 MB heap on the starter plan. Full-mode emission runs on `Dispatchers.Default` behind a `Semaphore(2)` that suspends (no new status code). Snippet mode never reads `base_html`.

### 1.4 CSS

```css
/* Vibe Motion · format 1 · v5 · saved 2026-09-20 (UTC) · catalog 1.1.0 */
@keyframes vm-fade-in-up-v1-1-0 { from { opacity: 0; transform: translateY(var(--vm-distance)); } to { opacity: 1; transform: none; } }

@media (prefers-reduced-motion: no-preference) {
  /* load */
  .vm-a17 {
    --vm-distance: 24px;
    animation: vm-fade-in-up-v1-1-0 600ms ease-out 0ms 1 normal both;
  }

  /* hover: custom properties and base styles always, the animation only while hovered */
  .vm-a42 { transform-origin: center; --vm-scale: 1.05; }
  .vm-a42:hover { animation: vm-hover-grow-v1-1-0 200ms ease-out 0ms 1 normal forwards; }

  /* in-view: only when the script is running, held on the first keyframe until it fires */
  :where(.vm-js) .vm-a63 { --vm-distance: 24px; animation: vm-fade-in-up-v1-1-0 600ms ease-out 0ms 1 normal both; }
  :where(.vm-js) .vm-in-view:not(.vm-play) { animation-play-state: paused; animation-delay: 0s; animation-fill-mode: both; }
}
```

Rules, each of which a test pins:

- **Keyframes** are emitted once per distinct `keyframesName(entry.id, catalogVersion)`, first-use order, as `@keyframes <name> { <entry.keyframes> }` — byte-identical to the preview's `keyframesCss`. They sit outside the media query (unused keyframes are inert).
- **The `animation` shorthand, always, in this order:** `name duration timing-function delay iteration-count direction fill-mode`. Duration is the first `<time>`, delay the second. A param the entry declares but the stored assignment omits takes the **catalog default** (as the preview's `resolveParams` does); a standard param the pinned entry does not declare at all is written at its CSS initial value (`0s`, `ease`, `0s`, `1`, `normal`, `none`), so catalog 1.0.0 (no `fillMode`) still resets fill-mode. The order is unambiguous for every catalog value: durations and delays always carry a unit, easing is a keyword or a function, iteration is `infinite` or a number, and keyframes names are `vm-…`, never a keyword; a catalog test pins each standard key to its value type. The shorthand resets every longhand, so a host rule cannot retime the animation (bridge spec §6a).
- **Order inside a rule:** the entry's `baseStyles` verbatim (trimmed, `;`-terminated), then `--vm-*` custom properties in catalog param order, then `animation`. Same cascade as the preview: ours win.
- **`hover`:** `.vm-aN:hover`. CSS `:hover` matches while any descendant is hovered, which is exactly the bridge's "arm the whole chain of tagged ancestors".
- **`in-view`:** gated on `:where(.vm-js)`, a class the script adds to `<html>`; `:where()` keeps the rule at specificity (0,1,0), the same as the preview's selector. Without JavaScript the element simply rests in its normal state; it is never left invisible on a first keyframe of `opacity: 0`. One hold rule serves every in-view element through the `vm-in-view` marker class. The gate and the marker are additions to the parity table in the bridge spec §6a, recorded there by Task A7.
- **Reduced motion:** every rule is inside `@media (prefers-reduced-motion: no-preference)`, base styles included, because decorative base styles (`underline-sweep`'s gradient) are part of the animation. A reader who asks for less motion sees the untouched page. Closes DT-091.
- No `!important`. Two-space indent, `\n` line endings, one trailing newline. Deterministic: the same inputs give the same bytes. The header carries only the format number, the version's `seq`, its `created_at` date in UTC and the catalog versions of the resolved entries; no label, title or URL ever reaches any output.
- **Snippet mode** emits the same header plus `/* add class="vm-aN" to the element */`, that assignment's keyframes and its rules.

### 1.5 JavaScript (only when some assignment uses `in-view`)

**A constant file with nothing interpolated into it.** It lives at `packages/bridge/src/vibe-motion-export.js` (the bridge package already has the real-browser harness and is copied into the API jar the same way as the bridge script), and the exporter returns its text unchanged. A dependency-free IIFE:

- adds `vm-js` to `<html>` immediately, then on `DOMContentLoaded` observes every `.vm-in-view` with **one** `IntersectionObserver` at `threshold: [0, T]`, `T = 0.2` (`IN_VIEW_THRESHOLD` in `packages/bridge/src/protocol.ts`; a test asserts the two agree);
- an entry fires when `isIntersecting && (intersectionRatio >= T || boundingClientRect.height * T >= rootHeight)`, where `rootHeight = entry.rootBounds ? entry.rootBounds.height : window.innerHeight`. The second clause is the corrected DT-095 rule: an element so tall that ratio `T` is unreachable fires on first intersection. (`rootBounds` is `null` when the exported page is itself inside a cross-origin iframe; reading `.height` off it would throw and leave everything held forever.);
- on fire it adds `vm-play` and unobserves: plays once;
- the callback is wrapped so that **any** exception, and the absence of `IntersectionObserver`, adds `vm-play` to every element. Nothing can be left held at `opacity: 0`.

The script tag is in `<head>` and **not deferred**, so `vm-js` is set before first paint. With `defer`, elements in the first viewport would paint at rest, snap to their first keyframe when the class lands, then play: the flash the hold rule exists to prevent. The cost is one small render-blocking request. An inline script would avoid the request but breaks hosts with a strict CSP. This departs from the build plan's literal `defer` (question 4).

The preview must fire on the same condition, so the bridge adopts the corrected rule in a small parallel PR (Task A12); `packages/bridge` is in neither open PR.

### 1.6 Errors

| Case | Response |
|---|---|
| unknown project, or `versionId` not in this project | 404 `not_found` (existing `ResourceNotFoundException`) |
| `versionId` absent | the project's current version |
| `versionId` / `projectId` not a UUID, `mode` not `full`/`snippet` | 400 `bad_request` |
| `mode=snippet` without `vmId`, or `vmId` not `^vm-[0-9]+$` | 400 `missing_vm_id` / `bad_request` (new `ExportRequestException` + one `StatusPages` arm; `code` is an open string in the contract and the mock already uses `missing_vm_id`) |
| `mode=snippet`, `vmId` has no assignment in that version | 404 `not_found` (the mock's silent empty 200 is changed to match) |
| an assignment whose pinned entry cannot be resolved, or whose stored param value fails re-validation | 500 and an error log that names the vmId and param key but never the value. Save-time validation plus the immutable catalog make this unreachable; silently skipping would export a page that differs from the preview. |

### 1.7 Safety of interpolated values

`vmId` matches `^vm-[0-9]+$` (DiffValidator). The animation id used in CSS is **`entry.id` from the resolved catalog entry**, never the stored string (closes DT-069 for the exporter). Param values passed save-time validation (`paramValueProblem`: no `;{}<>"'`, no `url(`, no `@import`, ≤ 200 chars); the exporter re-checks each value with the same function (`internal` is module-wide in Kotlin) and fails the export rather than emit a value that does not pass. A catalog-wide test asserts no entry's `keyframes` or `baseStyles` contains `<`, `</style`, `@`, a backslash, `/*`, or an unbalanced `{`/`}`, and that `baseStyles` declares no `animation*` or `--vm-*` property. The Export tab renders bundle text as text, never as HTML, and never builds a `text/html` blob URL on the web origin.

### 1.8 Cross-language parity

A committed fixture, `apps/web/lib/runtime-css/export-parity.json`, is produced by the real `runtime-css` functions for **every** published `(version, id)` in three cases each: no params, every param at a non-default value, and a partial set. Per case: `{ keyframesCss, longhands, customProperties, baseStyles }`, where `baseStyles` is TypeScript's *parsed, ordered* declaration map. `apps/web` has no TypeScript runner other than vitest, so staleness is a vitest test that regenerates with `VM_UPDATE_PARITY=1` (no new `package.json` script, no `check-generated` entry). A Gradle test-only resource task (the `catalogManifestResources` pattern; the API Docker build runs no tests, so it gains no dependency on `apps/web`) puts the file on the API test classpath, and `ExportParityTest` asserts: the fixture's pair set equals every published pair (it fails, not skips, when the file is missing); identical keyframes text; identical custom properties in identical order; Kotlin's split of the verbatim `baseStyles` equals the parsed map with no duplicate property; and the Kotlin shorthand, expanded back to longhands, equals `longhands` with absent ones at their initial values. Triggers are not in the fixture (TypeScript has no trigger CSS); the real-browser specs in A6 and A10 cover them.

## 2. File structure

```
apps/api/src/main/kotlin/dev/vibemotion/api/export/
  ExportModels.kt        ExportMode, ExportRequest, ExportBundleDto, ExportFile
  CssEmitter.kt          keyframes, shorthand, rules per trigger, media wrapper, header, snippet
  InViewScript.kt        loads the constant script from the classpath
  HtmlEmitter.kt         jsoup parse, data-vm-id → classes, HtmlSanitiser, link/script insertion
apps/api/src/main/kotlin/dev/vibemotion/api/clone/HtmlSanitiser.kt   extracted from HtmlRewriter (A0)
packages/bridge/src/vibe-motion-export.js      the constant in-view script (+ e2e in packages/bridge/e2e)
  ExportService.kt       one transaction (project, version, diffs, base_html), then pure emitters
apps/api/src/main/kotlin/dev/vibemotion/api/routes/ExportRoutes.kt
apps/api/src/test/resources/golden/export/   three fixture states × {html, css, js}

apps/web/components/export/
  code-block.tsx  file-tabs.tsx  export-panel.tsx (presentational)  export-tab.tsx (container, useQuery)
  use-clipboard.ts  build-zip.ts  download.ts  readme.ts  export-stats.ts
apps/web/app/dev/export/page.tsx               store-free frames, 404 in production, NOT linked from dev-gallery.tsx
apps/e2e/web/mocked/export-dev.spec.ts         the /dev/export frames
apps/e2e/web/stack/export.spec.ts              the phase exit criterion, driven through the API
```

## 3. Track A — the Kotlin exporter (`apps/api`, `apps/e2e/web/stack`, one new `apps/web` script)

Each task is TDD: the failing Kotest first. One commit per task.

- [ ] **A0 extract `HtmlSanitiser`** from `HtmlRewriter.kt` (base-free, see §1.3); `HtmlRewriter` calls it. Gate: every clone golden byte-identical, all existing `HtmlRewriterTest` cases green. New unit tests for the sanitiser on its own.
- [ ] **A1 `ExportModels`** and the class rule (`vm-17` → `vm-a17`; reject anything not `^vm-[0-9]+$`).
- [ ] **A2 round-trip characterisation.** Tests: parse → serialise is the identity on the three clone goldens (a characterisation, not a gate); `export(export(x)) == export(x)`; a hostile corpus (`<plaintext>`, `<pre>` leading newline, nested `<form>`, `<math><mtext><mglyph><style><img onerror>`, `<svg><style>`) exports with no executable content; each `data-vm-id` maps to its class exactly once.
- [ ] **A3 `CssEmitter` core.** Tests: shorthand order and initial-value defaults for an entry with no `fillMode` (1.0.0) and one with everything; custom properties in catalog order; base styles first; keyframes deduplicated by name with two assignments sharing an animation and with the same animation pinned to 1.0.0 and 1.1.0 (two blocks); declared-but-omitted params take the catalog default; the header uses `format 1`, the version's `seq` and its `created_at` in UTC; re-validation failure throws; `entry.id` is used even when the stored `animationId` differs in case. Property test (`kotest-property`): for arbitrary valid states the output is deterministic and contains exactly one rule group per assignment.
- [ ] **A4 triggers, media wrapper, snippet.** Tests: one golden CSS per trigger; everything except keyframes is inside the reduced-motion media query; `hover` splits into resting and `:hover` rules; `in-view` rules are all prefixed `:where(.vm-js)`, the single hold rule targets `.vm-in-view:not(.vm-play)`, and specificity of every rule is (0,1,0) or (0,2,0) for `:hover`/`:not`; snippet output for each trigger including the class-name comment; no `!important` anywhere.
- [ ] **A5 `HtmlEmitter`.** Tests on the three clone goldens: all `data-vm-id` gone; class appended to an element with no class, one class, several classes; `vm-in-view` added beside it for in-view assignments; link is last in `<head>`; script present only when needed; the hostile golden exports with no `<script`, no `on*=`, no `javascript:`, no `<base`, no `<iframe`; an unassigned document differs from `base_html` only by the removed attributes and the link.
- [ ] **A6 the constant in-view script.** `packages/bridge/src/vibe-motion-export.js`, a Gradle resource copy beside `bridgeResources`, `InViewScript.kt` loading it. Real-browser specs in `packages/bridge/e2e` (red first): held at `currentTime` 0 below the fold, plays once on scroll, never replays; an element taller than five viewports fires on first intersection; inside a cross-origin iframe (`rootBounds` null) it still plays; with `IntersectionObserver` deleted everything plays; a throwing callback plays everything; `vm-js` is on `<html>` before first paint. Unit test: the threshold literal equals `IN_VIEW_THRESHOLD`; `node --check` passes; the file contains no template placeholders.
- [ ] **A7 parity fixture** per §1.8: the vitest generator/staleness test (`VM_UPDATE_PARITY=1`), the committed JSON, the Gradle test-resource task, `ExportParityTest`. Prove each side can fail by perturbing one value locally. Bridge spec §6a gains rows for `:where(.vm-js)`, `vm-in-view`, the non-deferred script and the corrected DT-095 firing condition; build plan Phase 7 is updated for the class rule and the script tag.
- [ ] **A8 `ExportService` + `ExportRoutes` + wiring.** One read-only `transactional {}` resolves the version first (absent → current), folds the diffs, and reads `base_html` only in full mode; emitters run outside it on `Dispatchers.Default`, full mode behind a suspending `Semaphore(2)`. `optionalUuidQuery`, `ExportRequestException`, the `StatusPages` arm, `exportRoutes(services.exports)`. Route tests with fakes for every row of §1.6; an integration test against Testcontainers Postgres for the happy path in both modes; response carries `X-Content-Type-Options: nosniff` (already global) and `Cache-Control: no-store`.
- [ ] **A9 goldens.** Three fixture states (load only; hover + in-view; mixed catalog pins with base styles) × the marketing-page clone golden → committed `index.html`, `vibe-motion.css`, `vibe-motion.js` under `golden/export/`, regenerated with the existing `VM_UPDATE_GOLDEN=1` switch.
- [ ] **A10 stack e2e, the exit criterion.** `apps/e2e/web/stack/export.spec.ts`, with its helpers local to the file (PR #21 creates `stack/helpers.ts`) and no fixture edit ("below the fold" comes from a small viewport): create a project from the fixture site, `POST` a version through the API assigning `fade-in-up` (load), a `hover` animation and an `in-view` one, `GET` the export, serve the three files from a Playwright route on a fresh page with **no** app and no bridge, and assert: the load element has a running animation named `vm-fade-in-up-v1-1-0`; the in-view element below the fold is paused at `currentTime` 0 and plays after scrolling to it, once; the hover element animates only while hovered; with `reducedMotion: "reduce"` nothing animates and the in-view element is visible; with JavaScript disabled the in-view element is visible and at rest.
- [ ] **A11** `pnpm gates`; PR with `code-architect` (exporter change), `code-reviewer`, `test-runner`.
- [ ] **A12 (small, parallel PR) the bridge adopts the corrected in-view firing condition** and the `rootBounds` fallback in `packages/bridge/src/vm-bridge.js`, with a real-browser spec for the very tall element; `BRIDGE_VERSION` patch bump; closes DT-095 for preview and export together.

## 4. Track B — Export tab components (new files only)

- [ ] **B1 `fflate`, `build-zip.ts`, `download.ts`, `readme.ts`.** Tests: the zip round-trips through `fflate`'s `unzipSync` to exactly the bundle's files plus `README.txt`; names come from `bundle.files`; the zip name is `vibe-motion-<slug>-v<seq>.zip` with a slug limited to `[a-z0-9-]`; `download.ts` is tested with `URL.createObjectURL` / `revokeObjectURL` stubbed explicitly (Node's ambient one must not be relied on) and revokes the URL.
- [ ] **B2 `use-clipboard.ts`.** `navigator.clipboard.writeText` when available, a hidden-textarea `execCommand("copy")` fallback otherwise, returns a boolean. Tests stub both paths and the absent-API path.
- [ ] **B3 `code-block.tsx`, `file-tabs.tsx`.** (Includes a test that an `<img onerror>` payload in the bundle text renders as text.) Handoff styling (ink block `#1d1d1f`, text `#d4d4d8`, mono 10.5px/1.6, radii `0 8px 8px 8px`, Copy pill). The unused `vibe-motion.js` tab is rendered faint and disabled. Text is rendered as text, never as HTML.
- [ ] **B4 `export-panel.tsx` (presentational).** Props: `bundle | undefined`, `status: "pending" | "error" | "ready"`, `versionLabel`, `isCurrent`, `mode`, `onModeChange`, `snippetAvailable`, `stats`, `onRetry`, `projectSlug`. Label EXPORTING + `v5 · current`; `Segmented` Full page / Snippet (Snippet disabled with a hint when no element is selected); the caption; file tabs; code block; footer `2 animations · 4 elements · js not needed (no in-view triggers)`; **Copy all** and **Download .zip**; toasts `Copied CSS` / `Copied HTML` / `Copied all` through the existing `useToast`. Tests by role and text; pending and error states; nothing fetches.
- [ ] **B5 `export-stats.ts`.** `(state) → { animations, elements, needsJs }` from a version state, so the bundle needs no new fields.
- [ ] **B6 `export-tab.tsx` (container).** Props `projectId`, `versionId`, `versionLabel`, `isCurrent`, `selectedVmId`, `state`. `useQuery` keyed `["project", projectId, "export", versionId, mode, vmId]`, `staleTime: Infinity` (a saved version is immutable), `retry: false`, typed error like `editor-shell.tsx`'s. Tested with per-test MSW handler overrides (the shared mock in `mocks/db.ts` is not edited until Track C). Not mounted anywhere yet.
- [ ] **B7 `/dev/export` + `export-dev.spec.ts`.** Its own route (as Phase 6 did with `/dev/history`), not linked from `dev-gallery.tsx`, which both open PRs edit. Store-free frames: full with JS, full without JS, snippet, pending, error. The e2e measures the 320px panel width, clicks Copy (Playwright clipboard permission granted in the spec) and asserts the toast, and asserts a download event with the right file name for Download .zip.
- [ ] **B8** `pnpm gates`; PR with `screenshot-runner` (compare with the handoff's Export tab), `code-reviewer`, `test-runner`.

## 5. Track C — wiring (after PR #21 and PR #22 are on `main`)

Seam check first. Then: **mock alignment** (`apps/web/mocks/db.ts`: file names per §1.1, class-free CSS stays, 404 for a snippet of an unassigned element; extend `handlers.test.ts`; DT-033 already says mock and real output are not byte-identical); a link to `/dev/export` from the gallery; `EditorShell` passes `projectId` to `ControlPanel`; the Export `TabsContent` mounts `ExportTab` with `viewingVersionId ?? currentVersionId` from Phase 6's store slice, the label and `isCurrent` from the versions query, `selectedVmId` from `selectSelectedVmId`, and the materialised state for the stats; the History row's disabled **Export vN** gets `onExport(versionId)` (switches to the Export tab on that version; closes DT-160); opening Export while unsaved offers **Save first** through Phase 6's `requestSave()` in the existing tab guard (closes DT-099); the three tests that assert the placeholder text are updated; a mocked e2e drives the real tab; the stack spec gains a pass through the UI. Docs: build plan Phase 7, `architecture.md` §3.4, `user_flow.md`.

## 6. Deferred, to log when implementation starts

`ETag` / `304` on the export endpoint (a contract addition; note the output also depends on the sanitiser build, which is the point of DT-073, so `no-store` is right for now); response compression on `/export` (no Compression plugin is installed; a 10 MB export travels uncompressed); bounding export memory once object storage (DT-009) lands; an `in-view` animation with delay > 0 and fill `none`/`forwards` shows its resting state during the delay, in preview and export alike; `<pre>` loses a leading newline on re-serialise; DT-070 (dedupe identical keyframes across pinned versions); DT-093 (base-style specificity); DT-116 (`underline-sweep` resting state, needs a catalog release and will be visible in exports); "just the HTML diff" for designers who cannot replace their page; minified output.

## 7. Questions for Chris

1. **Reduced motion and base styles.** This plan puts base styles inside the reduced-motion media query, so a reader who asks for less motion sees the page exactly as it was. The alternative keeps decorative base styles (for example the underline) visible but static. Recommendation: inside, as written.
2. **Without JavaScript, `in-view` elements do not animate at all** (they rest, visible). The alternative, animating on load, would differ from what the designer previewed. Recommendation: as written.
3. **A snippet for an element with no animation is a 404**, and the tab disables Snippet until an animated element is selected. Recommendation: as written.
4. **The in-view script is loaded in `<head>` without `defer`.** The build plan says `<script src="vibe-motion.js" defer>`. Deferred, first-viewport in-view elements flash (rest → hidden → play). Recommendation: not deferred, as written; one small render-blocking request. The architect agrees with recommendations 1–4.
