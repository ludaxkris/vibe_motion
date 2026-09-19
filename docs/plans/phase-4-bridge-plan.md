# Phase 4 — Selection bridge and live preview: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `CLAUDE.md` first; it is binding.

**Goal:** Clicking an element in the preview iframe highlights it and opens the Control Panel, and changing a param updates that element inside the iframe within one frame, with no API call.

**Architecture:** The shell computes all CSS with `apps/web/lib/runtime-css` and sends finished `AppliedAssignment` payloads over an origin-checked `postMessage` channel. The bridge script inside the iframe is a dumb renderer: it keeps `original → applied → preview` layers per element, arms triggers, maintains one `<style id="vm-runtime">`, and draws the hover and selection overlay. The script lives in a new workspace package, `packages/bridge`, that both the API jar and the web mock route serve.

**Tech stack:** plain JS (ES2019, no build step, `// @ts-check`) + TypeScript types, vitest + jsdom, Zustand 5, Next.js 16, Ktor 3 / Gradle, Playwright.

**Spec:** [phase-4-bridge-protocol.md](phase-4-bridge-protocol.md). The spec is the authority; where this plan and the spec disagree, the spec wins. Section numbers below (§) refer to it.

## Global constraints

- Envelope is `{ source: "vibe-motion", type, payload, seq? }`. Message type names are exactly those in spec §3. `protocolVersion` is `1`.
- `postMessage` target origin is always explicit; the string `"*"` never appears as a target origin on either side.
- A receiver drops a message unless origin, `event.source`, envelope shape and known type all pass (§2).
- The bridge never builds a keyframes name and never reads the catalog. The shell always calls `keyframesName()` from `animation-catalog`.
- Everything the bridge injects into the page is prefixed: `id="vm-runtime"`, `data-vm-overlay`, `--vm-*`, keyframes `vm-*`.
- Live preview never calls the API (CLAUDE.md rule 9). No task in this plan adds a network call to the edit loop.
- Validation regexes (§1 D1): vmId `/^vm-[a-z0-9-]+$/`, keyframesName `/^vm-[a-z0-9-]+$/`, style key `/^(animation-(?!name$)[a-z-]+|--vm-[a-z0-9-]+)$/`.
- `IN_VIEW_THRESHOLD = 0.2`, exported from `protocol.ts`, used by the bridge and later by the Phase 7 exporter.
- TDD: failing test first. Conventional commits. Kotlin: no `!!`. Generated files are never hand-edited. No screenshots on working branches.
- Contracts are additive: `apps/api/openapi.yaml` is not changed by this phase.

## Sequencing

| Tasks | Can start | Touches in-flight files? |
|---|---|---|
| 1–5 (`packages/bridge`) | now | no |
| 6–7 (`apps/web/lib/bridge`, store factory) | when Phase 3 is on `main` (imports its store and `runtime-css`) | no Phase 3 file is rewritten; two are extended |
| 8 (API wiring) | when Phase 2 is on `main` | yes: moves Phase 2's `vm-bridge.js` |
| 9 (shell integration) | when Phase 3 is on `main` | yes: `editor-shell.tsx`, mock route, fixture |
| 10 (e2e, perf, docs) | after 8 and 9 | no |

Tasks 1–5 are strictly sequential (one file). Tasks 6–7 can run in a second worktree in parallel with 1–5 once Phase 3 has merged, because they depend only on `protocol.ts` from Task 1.

**Task 0 — Seam check (do this first, again before Task 6, and again before Task 8).** The plan was written against unmerged branches. Verify each assumption below against `main`; where one no longer holds, fix the plan text in the same PR before writing code.

- [ ] Phase 3: `apps/web/lib/runtime-css/index.ts` exports `resolveParams`, `keyframesCss(entry, catalogVersion)`, `assignmentStyle(entry, catalogVersion, params)` (returns a map that **includes** `animation-name`), `runtimeStylesheet(pairs)`.
- [ ] Phase 3: `apps/web/lib/store/index.ts` exports `useEditorStore`, actions `setSelectedVmId`, `setDraftAssignment`, `updateDraftParam`, `removeDraftAssignment`, `dispatchPanel`, `reset`, and state `draftState`, `currentVersionState`, `panel`, `mode`.
- [ ] Phase 3: `apps/web/lib/preview-url.ts` exports `previewPageUrl(projectId)`; `apps/web/lib/env.ts` exports `env.apiOrigin`, `env.apiMocking`, `env.isProduction`.
- [ ] Phase 3: iframe is rendered in `apps/web/components/editor/editor-shell.tsx`; mock page route is `apps/web/app/mock-api/projects/[projectId]/page/route.ts`; fixture is `apps/web/mocks/fixtures/page.ts` with ids such as `vm-heading`, `vm-button`.
- [ ] Phase 3 has been rebased so `keyframesName("fade-in", "1.1.0") === "vm-fade-in-v1-1-0"`.
- [ ] Phase 2: `apps/api/src/main/resources/bridge/vm-bridge.js` exists; `BridgeAssets.kt` has `BRIDGE_PATH`, `BRIDGE_VERSION`; `BridgePageRenderer` injects `<script src data-vm-parent-origin defer>`; CSP `BASE_POLICY` still allows `style-src 'unsafe-inline'`.
- [ ] Phase 2: `apps/api/Dockerfile` copies packages explicitly (a `COPY packages/animation-catalog ...` line exists).

---

### Task 1: `packages/bridge` scaffold and `protocol.ts`

**Files**
- Create: `packages/bridge/package.json`, `tsconfig.json`, `vitest.config.ts`, `README.md`
- Create: `packages/bridge/src/protocol.ts`, `packages/bridge/src/vm-bridge.js` (header + constants only in this task)
- Create: `packages/bridge/test/protocol.test.ts`
- Modify: `scripts/gates.mjs` (new `bridge` group), root `package.json` (`gates:bridge`), `pnpm-workspace.yaml` only if `packages/*` is not already globbed, `.github/workflows/gates.yml` (bridge job mirroring the catalog job)

**Interfaces — produces**

```ts
// packages/bridge/src/protocol.ts
export const MESSAGE_SOURCE = "vibe-motion" as const;
export const PROTOCOL_VERSION = 1 as const;
export const IN_VIEW_THRESHOLD = 0.2 as const;
export const BULK_APPLY_LIMIT = 8 as const; // more changed entries than this => state:load

export const VM_ID_RE = /^vm-[a-z0-9-]+$/;
export const KEYFRAMES_NAME_RE = /^vm-[a-z0-9-]+$/;
export const STYLE_KEY_RE = /^(animation-(?!name$)[a-z-]+|--vm-[a-z0-9-]+)$/;

export type Trigger = "load" | "hover" | "in-view";
export type Rect = { x: number; y: number; width: number; height: number };
export type ElementInfo = {
  vmId: string; tag: string; role: string | null; textPreview: string;
  rect: Rect; pageRect: Rect; order: number; visible: boolean;
};
export type AppliedAssignment = {
  vmId: string; trigger: Trigger; keyframesName: string; keyframesCss: string;
  style: Record<string, string>; baseStyles: string;
  animationId: string; catalogVersion: string; params: Record<string, string>;
};
export type AckError = "unknown-element" | "invalid-payload";

export type ToShell =
  | { type: "ready"; payload: { elementCount: number; bridgeVersion: string; protocolVersion: number } }
  | { type: "element:hover"; payload: ElementInfo | { vmId: null } }
  | { type: "element:select"; payload: ElementInfo }
  | { type: "element:deselect"; payload: { reason: "escape" | "background" } }
  | { type: "ack"; payload: { seq: number; ms: number; ok: boolean; error?: AckError } };

export type ToBridge =
  | { type: "hello"; payload: Record<string, never> }
  | { type: "select"; payload: { vmId: string | null; label?: string; scrollIntoView?: boolean } }
  | { type: "apply"; payload: AppliedAssignment }
  | { type: "clear"; payload: { vmId: string } }
  | { type: "replay"; payload: { vmId: string | null } }
  | { type: "preview"; payload: AppliedAssignment }
  | { type: "preview:clear"; payload: Record<string, never> }
  | { type: "state:load"; payload: { assignments: AppliedAssignment[] } };

export type Envelope<M extends { type: string; payload: unknown }> =
  M & { source: typeof MESSAGE_SOURCE; seq?: number };

export function isEnvelope(data: unknown): data is Envelope<{ type: string; payload: unknown }> {
  return typeof data === "object" && data !== null
    && (data as { source?: unknown }).source === MESSAGE_SOURCE
    && typeof (data as { type?: unknown }).type === "string";
}

export function validateApplied(a: AppliedAssignment): boolean {
  return VM_ID_RE.test(a.vmId) && KEYFRAMES_NAME_RE.test(a.keyframesName)
    && (a.trigger === "load" || a.trigger === "hover" || a.trigger === "in-view")
    && typeof a.keyframesCss === "string" && typeof a.baseStyles === "string"
    && Object.keys(a.style).every((k) => STYLE_KEY_RE.test(k));
}
```

`package.json`: name `bridge`, private, `type: module`, exports `"."` → `./src/protocol.ts` (consumed as TS source by `apps/web`, the same way the repo consumes workspace TS today; if `animation-catalog`'s `dist/` pattern is what `apps/web` resolves, mirror that instead and add a `build` script) and `"./vm-bridge.js"` → `./src/vm-bridge.js`. Scripts: `test` = `vitest run`, `typecheck` = `tsc -p tsconfig.json` with `allowJs` + `checkJs` so the script is type-checked against `protocol.ts` via JSDoc imports.

- [ ] **Step 1:** write `test/protocol.test.ts`: `isEnvelope` accepts a good envelope, rejects `null`, wrong `source`, missing `type`; `validateApplied` accepts a good payload and rejects, one case each: vmId `vm-1"]{}`, keyframesName `fade-in`, style key `animation-name`, style key `color`, trigger `"click"`; `STYLE_KEY_RE` accepts `animation-duration`, `--vm-distance`.
- [ ] **Step 2:** run `pnpm --filter bridge test`; expect failure (module missing).
- [ ] **Step 3:** add the scaffold and `protocol.ts` exactly as above; `vm-bridge.js` contains only the file header, `// @ts-check`, `"use strict"` IIFE, `var BRIDGE_VERSION = "1.0.0";`.
- [ ] **Step 4:** run `pnpm --filter bridge test && pnpm --filter bridge typecheck`; expect pass.
- [ ] **Step 5:** add the `bridge` gate group to `scripts/gates.mjs` (`bridge typecheck`, `bridge test`) and the CI job; run `pnpm gates:bridge`; expect ALL GREEN.
- [ ] **Step 6:** commit `feat(bridge): packages/bridge scaffold, protocol types and validation`.

### Task 2: Bridge core — handshake, origin checks, dispatch, ack

**Files:** modify `packages/bridge/src/vm-bridge.js`; create `packages/bridge/test/harness.ts`, `packages/bridge/test/handshake.test.ts`.

**Interfaces — produces (test harness, used by Tasks 3–5)**

```ts
// test/harness.ts
export type Harness = {
  window: Window;                       // the jsdom window the script runs in
  sent: Array<{ data: unknown; targetOrigin: string }>; // what the bridge posted to parent
  send(msg: { type: string; payload: unknown; seq?: number },
       opts?: { origin?: string; source?: unknown }): void; // dispatch a MessageEvent into the frame
  lastAck(): { seq: number; ms: number; ok: boolean; error?: string } | undefined;
  el(vmId: string): HTMLElement;
};
export function loadBridge(html: string, opts?: { parentOrigin?: string | null }): Harness;
```

`loadBridge` builds a `JSDOM` with `runScripts: "outside-only"`, replaces `window.parent` with a stub whose `postMessage(data, targetOrigin)` records into `sent`, appends a `<script data-vm-parent-origin="http://localhost:3000">` element and sets it as `document.currentScript` while evaluating the script source read from `src/vm-bridge.js`, then fires `DOMContentLoaded`. Default `origin` for `send` is the parent origin and default `source` is `window.parent`.

Behaviour to implement: read `parentOrigin` from `document.currentScript.dataset.vmParentOrigin`; `post(type, payload)` that refuses to send when `parentOrigin` is missing or `window.parent === window`; build `Map<vmId, Element>` once; send `ready { elementCount, bridgeVersion, protocolVersion: 1 }` at `DOMContentLoaded`; one `message` listener that applies the four checks of §2, dispatches by `type` through a handler table, ignores unknown types, times the handler with `performance.now()` and sends `ack` when `seq` is a number; `hello` re-sends `ready`. Keep Phase 2's capture-phase `click`/`submit` `preventDefault`.

- [ ] **Step 1:** tests, one `it` each: sends `ready` once on load with the right `elementCount` and `protocolVersion: 1`; every post uses `targetOrigin === parentOrigin`; sends nothing when `data-vm-parent-origin` is absent; `hello` produces a second `ready` and an `ack`; a message from origin `http://evil.test` produces no `ack`; a message whose `source` is not `window.parent` produces no `ack`; a message with `source: "other"` produces no `ack`; unknown type `"nope"` with `seq: 5` is ignored without throwing (no ack); `ack.ms` is a finite number ≥ 0.
- [ ] **Step 2:** run; expect failures.
- [ ] **Step 3:** implement. **Step 4:** run tests + typecheck; expect pass.
- [ ] **Step 5:** commit `feat(bridge): handshake, origin checks, dispatch and ack`.

### Task 3: Bridge rendering — layers, `vm-runtime`, `apply` / `clear` / `state:load`

**Files:** modify `src/vm-bridge.js`; create `test/render.test.ts`.

Implement per §1 D6 and §4: per-element record `{ original: Map<prop,{value,priority}>, applied: AppliedAssignment|null, preview: AppliedAssignment|null, armed: boolean }`; `snapshot(el, prop)` records once and never while the bridge owns the prop; `render(el)` writes `--vm-*` always and the `animation-*` group (`animation-name`, longhands, `animation-play-state: running`, all `!important`) only while armed, restoring from `original` otherwise; keys dropped between two `apply` calls are restored; keyframes reference count keyed by `keyframesName`; `rebuildRuntime()` writes `<style id="vm-runtime">` text = keyframes blocks + `[data-vm-id="…"] { baseStyles }` rules, called only when the set of names or base rules changes. In this task every trigger arms immediately (Task 4 replaces that). `apply` validates with the Task 1 regexes (duplicate the three regex literals in the script; a test asserts they equal `protocol.ts`'s `.source`).

- [ ] **Step 1:** tests: `apply` on `vm-heading` sets inline `animation-name` (priority `important`), `animation-duration`, `--vm-distance`, and `#vm-runtime` contains the keyframes block exactly once; a second `apply` changing only `animation-duration` does **not** change `#vm-runtime.textContent` (assert identity of the text node value and that a `MutationObserver` saw no change); two elements sharing a keyframes name produce one block, and clearing one keeps it, clearing both removes it; `clear` restores a pre-existing host inline `animation-duration: 9s` with its priority and removes `--vm-distance`; applying A (with `--vm-distance`) then B (without) removes `--vm-distance`; repeated `apply` does not overwrite `original`; host inline `animation: spin 2s` shorthand is restored after `clear`; non-empty `baseStyles` yields a `[data-vm-id="vm-heading"] { … }` rule, removed on `clear`; unknown vmId acks `ok:false, error:"unknown-element"`; style key `color` acks `error:"invalid-payload"` and writes nothing; `state:load` with 3 assignments after 2 existing ones leaves exactly those 3 and rewrites `#vm-runtime` once; regex parity with `protocol.ts`.
- [ ] **Step 2–4:** fail, implement, pass. **Step 5:** commit `feat(bridge): layered rendering, vm-runtime stylesheet, apply/clear/state:load`.

### Task 4: Triggers, `replay`, `preview`

**Files:** modify `src/vm-bridge.js`; create `test/triggers.test.ts`. jsdom has no `IntersectionObserver`: the harness installs a controllable fake (`harness.intersect(vmId, boolean)`), and the script reads `window.IntersectionObserver` at call time.

Implement §1 D3: `load` arms on apply; `hover` arms/disarms from delegated `pointerover`/`pointerout` on `document` (resolve nearest `[data-vm-id]`, ignore moves within the same element); `in-view` uses one shared observer with `threshold: 0.2`, re-arming on every entry. `replay { vmId|null }`: arm if needed, set `animation-name: none`, read `getComputedStyle(el).animationName`, restore the name, same task; for `hover`/`in-view` disarm again on `animationend` unless the trigger is naturally armed. `preview`: single slot, replaces any existing preview, always armed and played once; `preview:clear` re-renders from `applied`; an `apply` during a preview updates `applied` only. **Hold on first keyframe (spec D3, owner decision §9.3):** an unarmed `in-view` element does not restore the snapshot; it renders the group with `animation-play-state: paused`, `animation-delay: 0s`, `animation-fill-mode: both`, all `!important`, and arming rewrites the assignment's own delay and fill-mode with `running`. `hover` and `load` are unaffected.

- [ ] **Step 1:** tests: hover assignment has no inline `animation-name` until `pointerover`, has it after, loses it after `pointerout`; while unarmed, host inline `animation-duration` is untouched; a param-only `apply` on an unarmed hover element changes `--vm-*` only; in-view arms on `intersect(true)`, disarms on `intersect(false)`, arms again; an unarmed in-view element has inline `animation-name` set with `animation-play-state: paused`, `animation-delay: 0s`, `animation-fill-mode: both`, and after arming has `running` plus the assignment's own delay and fill-mode; clearing a held in-view element restores the host's original inline values; exactly one observer instance is constructed for 5 in-view assignments; `replay` on an armed load element sets name to `none` then back within the handler (spy on `style.setProperty` call order and on `getComputedStyle`); `replay {vmId:null}` touches every assigned element; `preview` over an applied element shows the preview name, `preview:clear` shows the applied name again and `original` is unchanged; `apply` during preview does not change the rendered name; a second `preview` on another element clears the first; preview keyframes are removed from `#vm-runtime` on `preview:clear` when nothing else uses them.
- [ ] **Step 2–4:** fail, implement, pass. **Step 5:** commit `feat(bridge): trigger arming, replay and transient preview`.

### Task 5: Overlay, hover / select / deselect, `ElementInfo`

**Files:** modify `src/vm-bridge.js`; create `test/selection.test.ts`.

Implement §4 overlay (`<div data-vm-overlay>` fixed container, `pointer-events:none`, hover outline 1.5px dashed `#7c5cff`, selection ring 2px solid `#7c5cff` offset 6px with mono label, `cursor: crosshair` on `html`), rAF-throttled reposition from capture-phase passive `scroll` and `resize`; `elementInfo(el)` per §3; capture-phase `click` → `preventDefault` + `stopPropagation`, nearest tagged ancestor → `element:select`, none → `element:deselect {reason:"background"}`; `keydown` Escape → `element:deselect {reason:"escape"}`; `element:hover` only when the vmId changes, `{vmId:null}` on leaving; `select { vmId, label, scrollIntoView }` draws the ring (label defaults to the tag), `select {vmId:null}` removes it. **A click never moves the ring by itself (spec D10)**; only `select` does. Overlay nodes never carry `data-vm-id` and are skipped when resolving targets.

- [ ] **Step 1:** tests: click on a `<span>` without id inside `vm-button` selects `vm-button` with `tag:"button"` and collapsed `textPreview` ≤ 80 chars; click is `defaultPrevented`; a click sends `element:select` but creates no ring until `select` arrives, and an existing ring stays on the previously selected element; click on `<body>` sends `element:deselect` background; Escape sends `element:deselect` escape; moving within one element sends one `element:hover`, moving to another sends a second, leaving sends `{vmId:null}`; `select` creates a ring with the label text, `select null` removes it; the overlay container is not counted in `ready.elementCount`; `ElementInfo.order` follows document order.
- [ ] **Step 2–4:** fail, implement, pass. **Step 5:** `pnpm gates:bridge`; commit `feat(bridge): overlay, hover/select/deselect and ElementInfo`.

### Task 6: Web — store factory, element metadata, `toApplied()`

**Requires Phase 3 on `main`; run Task 0 first.**

**Files**
- Modify: `apps/web/lib/store/index.ts` (+ its test): export `createEditorStore()` returning a vanilla-compatible Zustand store; `useEditorStore` becomes the default instance created from it. Add state `hoverVmId: string | null`, `elements: Record<string, ElementInfo>`, `pendingSelectVmId: string | null`, `guardOpen: boolean`; actions `setHoverVmId(vmId)`, `rememberElement(info)`, `requestSelect(vmId | null)`, `resolveGuard(outcome: "discard" | "keep" | "saved")`; selector `selectElementDirty(state, vmId)` (draft entry differs from `currentVersionState` entry, including added and removed). Semantics are spec §5 "Unsaved-changes guard on element switch". `reset()` clears all of them.
- Create: `apps/web/lib/bridge/to-applied.ts`, `to-applied.test.ts`
- Modify: `apps/web/package.json` (workspace dependency on `bridge`)

**Interfaces — produces**

```ts
// apps/web/lib/bridge/to-applied.ts
import type { AppliedAssignment } from "bridge";
import type { Assignment } from "@/lib/store";
export type Unresolved = { vmId: string; reason: "unknown-version" | "unknown-animation" };
export function toApplied(vmId: string, assignment: Assignment): AppliedAssignment | Unresolved;
export function isUnresolved(x: AppliedAssignment | Unresolved): x is Unresolved;
```

`toApplied` resolves `getEntry(assignment.catalogVersion, assignment.animationId)` from `animation-catalog` (multi-version, not `lib/catalog.ts`'s current-only helpers), then: `keyframesName` from the package, `keyframesCss(entry, version)`, `style` = `assignmentStyle(entry, version, params)` **minus** `animation-name`, `baseStyles` = `entry.baseStyles ?? ""`, `params` = `resolveParams(entry, assignment.params)`.

- [ ] **Step 1:** tests: a `fade-in-up` assignment pinned to `1.1.0` yields `keyframesName === "vm-fade-in-up-v1-1-0"`, `style` has `animation-duration`, `animation-fill-mode`, `--vm-distance` and no `animation-name`; the same animation pinned to `1.0.0` yields `vm-fade-in-up-v1-0-0` and no `animation-fill-mode`; `scale-in` carries its `baseStyles`; unknown version → `Unresolved "unknown-version"`; unknown id → `"unknown-animation"`; every result passes `validateApplied`, asserted over **every** `(version, id)` in `CATALOGS` with defaults. Store: two `createEditorStore()` instances do not share `draftState`; `rememberElement` then `reset` empties `elements`. Guard: `requestSelect(b)` with clean `a` selects `b`; with `a` dirty (animation added) keeps `a`, sets `pendingSelectVmId = b`, `guardOpen = true`; a changed param also counts as dirty; `requestSelect(a)` while `a` is selected is a no-op; `requestSelect(null)` while dirty does nothing and opens no dialog, while clean it deselects; `resolveGuard("discard")` restores `a`'s entry from `currentVersionState` (removing it when there was none) and selects `b`; `resolveGuard("keep")` clears the pending selection and keeps `a`; `resolveGuard("saved")` selects `b` without touching the draft.
- [ ] **Step 2–4:** fail, implement, pass (`pnpm --filter web test`, `typecheck`, `lint`). **Step 5:** commit `feat(web): store factory, element metadata and toApplied builder`.

### Task 7: Web — framework-free bridge client

**Files:** create `apps/web/lib/bridge/client.ts`, `client.test.ts`, `index.ts`.

**Interfaces — produces**

```ts
export type BridgeStatus = "connecting" | "ready" | "version-mismatch";
export type BridgeClient = {
  status(): BridgeStatus;
  hello(): void;                                   // call on mount and on iframe load
  preview(vmId: string, assignment: Assignment): void;
  clearPreview(): void;
  replay(vmId: string | null): Promise<Ack>;
  whenIdle(): Promise<void>;                       // resolves when every sent seq is acked (tests, perf)
  destroy(): void;
};
export type Ack = { seq: number; ms: number; ok: boolean; error?: string };
export function createBridgeClient(opts: {
  target: () => Window | null;                     // iframe.contentWindow
  expectedOrigin: string;
  listenOn: Window;                                // where "message" events arrive
  store: EditorStoreApi;                           // from createEditorStore()
  raf?: (cb: () => void) => void;                  // injectable for tests
  onUnresolved?: (u: Unresolved[]) => void;
}): BridgeClient;
```

Behaviour (§5, §1 D7): inbound filter = origin + `event.source === target()` + `isEnvelope`; `ready` with `protocolVersion !== 1` → status `version-mismatch`, send nothing; any `ready` → reject pending acks, set `ready`, send `state:load` built from `draftState` via `toApplied` (unresolved entries reported through `onUnresolved`, not sent), then `select` for the current selection; before `ready`, draft changes are not sent and not queued, because the full state is re-derived and sent as `state:load` at `ready`; `element:select` → `rememberElement` + `requestSelect(vmId)`; `element:hover` → `setHoverVmId`; `element:deselect` → `requestSelect(null)`; the client sends `select` only when the store's selected vmId actually changes, so a refused selection leaves the ring where it was (spec D10); store subscription diffs `draftState` by reference per vmId, coalesces per rAF into `apply`/`clear`, or one `state:load` when more than `BULK_APPLY_LIMIT` entries changed; selection change → `select` with label `"<tag> · <Animation name>"` when metadata and an assignment exist; `seq` increases monotonically; `destroy` removes listener and subscription.

- [ ] **Step 1:** tests with a fake target `{ postMessage: vi.fn() }` and a real `createEditorStore()`: nothing is posted before `ready`; `hello()` posts `hello` to `expectedOrigin`; on `ready` exactly one `state:load` then one `select`; messages from a wrong origin or wrong source are ignored; `protocolVersion: 2` → status `version-mismatch` and no posts; `updateDraftParam` ×5 within one frame → one `apply` after `raf` flushes, carrying the last value; `removeDraftAssignment` → `clear`; 9 `setDraftAssignment` in one tick → one `state:load`, zero `apply`; inbound `element:select` lands the panel in `selected` (or `tuning` when a draft exists) and stores `ElementInfo`; `element:deselect` deselects when clean; with a dirty selected element an inbound `element:select` for another element posts **no** `select`, opens the guard, and after `resolveGuard("discard")` posts the reverting `apply`/`clear` followed by `select` for the pending element; a second `ready` rejects a pending `replay()` promise and resends `state:load`; an unresolvable assignment is reported and not sent; no posted call ever has `"*"` as target origin; `destroy()` stops everything.
- [ ] **Step 2–4:** fail, implement, pass. **Step 5:** commit `feat(web): origin-checked bridge client driven by the draft store`.

### Task 8: API wiring — serve the package's script

**Requires Phase 2 on `main`; run Task 0 first. Edits Phase 2 files.**

**Files**
- Delete: `apps/api/src/main/resources/bridge/vm-bridge.js` (its two behaviours, `ready` and navigation blocking, are covered by Tasks 2 and 5)
- Modify: `apps/api/build.gradle.kts` (new `bridgeResources` Sync task copying `packages/bridge/src/vm-bridge.js` to `build/generated/bridge/bridge/vm-bridge.js`, wired into `sourceSets.main.resources` exactly like `catalogResources`), `apps/api/Dockerfile` (`COPY packages/bridge /workspace/packages/bridge` next to the catalog copy), `clone/BridgeAssets.kt` (`BRIDGE_VERSION` becomes a lazy value parsed from the script with `Regex("""BRIDGE_VERSION\s*=\s*"([^"]+)"""")`, failing loudly when absent), `BridgeAssetsTest.kt` (keep the wildcard-origin ban and envelope smoke assertions; assert the parsed version is a semver and not `*-stub`; drop assertions now owned by vitest)

- [ ] **Step 1:** change `BridgeAssetsTest` first (parsed version is semver; script contains `addEventListener("message"`); run `./gradlew test --tests "*BridgeAssets*"`; expect failure against the stub.
- [ ] **Step 2:** add the Gradle task, Dockerfile line, delete the stub, parse the version. **Step 3:** `./gradlew check` and `docker build -f apps/api/Dockerfile .`; expect pass, and `unzip -l build/libs/*.jar | grep bridge/vm-bridge.js` shows the script.
- [ ] **Step 4:** commit `feat(api): serve the bridge script from packages/bridge`.

### Task 9: Shell integration — hook, sandbox, cross-origin mock

**Requires Phase 3 on `main`. Edits Phase 3 files.**

**Files**
- Create: `apps/web/lib/bridge/use-bridge.ts` (React hook: creates the client for an iframe ref, calls `hello()` on mount and on the iframe `load` event, destroys on unmount, exposes `status`)
- Modify: `apps/web/components/editor/editor-shell.tsx` (iframe `ref`, `onLoad`, `sandbox="allow-scripts allow-same-origin"`, version-mismatch banner), `apps/web/lib/preview-url.ts` (mock mode returns `http://127.0.0.1:<port>/mock-api/projects/<id>/page`, derived from `location` by swapping `localhost` ↔ `127.0.0.1`; export `previewOrigin(projectId)`), `apps/web/app/mock-api/projects/[projectId]/page/route.ts` (inject `<script src="/mock-api/bridge/vm-bridge.js" data-vm-parent-origin="…" defer>` and send the same CSP string as `BridgePageRenderer.BASE_POLICY` plus `frame-ancestors`), create `apps/web/app/mock-api/bridge/vm-bridge.js/route.ts` (reads the package file with `fs.readFile` inside the handler, after the `env.apiMocking` check; 404 otherwise), `apps/web/next.config.*` (`allowedDevOrigins: ["127.0.0.1"]` if the spike shows it is needed), Control Panel wiring for card-hover preview and Replay only where those components exist on `main` (call `client.preview` / `clearPreview` / `replay`). Create `apps/web/components/editor/unsaved-guard-dialog.tsx` per the handoff's dialog `2g` (380px; title "Save changes to <tag>?"; body names the animation; actions **Discard** red text left, **Keep editing** secondary, **Save** primary), driven by `guardOpen` / `resolveGuard`. `onSave` is an optional prop: absent in Phase 4, so Save renders disabled with the tooltip "Saving arrives with version history"; Phase 6 passes it.

- [ ] **Step 1 (spike, 15 min cap):** run `next dev`, open the shell on `localhost:3000` with the iframe on `127.0.0.1:3000`; confirm the page loads, the script loads under `script-src 'self'`, and `ready` arrives with `event.origin === "http://127.0.0.1:3000"`. If Next blocks it, add `allowedDevOrigins`; if it still fails, stop and report (fallback: a second `next dev` port is **not** acceptable without asking).
- [ ] **Step 2a:** component tests for the guard dialog: renders the element tag and animation name; Discard / Keep editing call `resolveGuard` with `"discard"` / `"keep"`; Save is disabled without `onSave` and, with it, awaits `onSave()` then calls `resolveGuard("saved")`; Escape key equals Keep editing.
- [ ] **Step 2:** unit tests: `previewPageUrl` / `previewOrigin` in mock and real mode; mock page route returns the script tag, the parent-origin attribute and the CSP header, and 404s when mocking is off; bridge script route serves `application/javascript`.
- [ ] **Step 3–4:** implement; `pnpm --filter web test typecheck lint build`. **Step 5:** commit `feat(web): mount the bridge on the preview iframe; cross-origin mock page`.

### Task 10: e2e, performance test, docs sync, screenshots

**Files:** create `apps/e2e/web/stack/bridge.spec.ts`, `apps/e2e/web/stack/bridge-perf.spec.ts` (e2e moved to `apps/e2e` in PR #11; bridge specs need the real api, so they are stack specs run by `pnpm e2e:docker`); modify `docs/build_plan.md` (Phase 4 message table → point at the spec; replay wording), `docs/architecture.md` §3.2/§4 (bridge package, `hello`, `ack`, preview, mock origin), `CLAUDE.md` (repository map gains `packages/bridge`; commands gain `pnpm --filter bridge test`; naming rule already amended in the planning PR).

- [ ] **Step 1:** `bridge.spec.ts` (build plan exit criterion): create a project, click the fixture heading **inside the iframe** (`page.frameLocator("iframe").locator('[data-vm-id="vm-heading"]').click()`), assert the Control Panel shows the selected state; choose Custom → Fade In Up; assert inside the frame that `getComputedStyle` reports `animation-name: vm-fade-in-up-v1-1-0` and that `#vm-runtime` contains that keyframes name; change duration to 1200ms through the panel control; assert the element's **inline** `animation-duration` is `1200ms`; assert no request to `/projects/*/versions` was made during the whole flow (`page.on("request")`); Remove animation → inline `animation-name` gone. Guard: select the heading, add Fade In Up, click the fixture button inside the iframe → the guard dialog is visible, the selection ring is still on the heading (assert inside the frame), the panel still shows the heading; Keep editing closes it with nothing changed; click the button again → Discard → the heading's inline animation styles are gone and the ring and panel are on the button; with a clean selection, clicking another element switches with no dialog; Escape inside the frame deselects when clean and does nothing when dirty.
- [ ] **Step 2:** `bridge-perf.spec.ts`: enable CDP `Emulation.setCPUThrottlingRate {rate: 4}`; drive 120 rAF-paced `updateDraftParam` ticks through a test-only hook exposed when `NEXT_PUBLIC_API_MOCKING=enabled` (`window.__vmTest = { store, client }`); record store-set → ack round trips; assert p95 < 16 ms and max `ack.ms` < 4 ms; then `state:load` with 200 synthetic assignments on a 200-element fixture variant, assert `ack.ms` < 50 ms.
- [ ] **Step 3:** run `pnpm gates`; expect ALL GREEN including the new `bridge` group.
- [ ] **Step 4:** docs sync as listed; post the `memory.md` Notice for the bridge protocol (shared contract) on `main`.
- [ ] **Step 5:** `screenshot-runner`: hover outline, selection ring with label, tuning with a live animation; then `code-architect` (bridge protocol change → required by CLAUDE.md), `code-reviewer`, `test-runner` on the final commit.
- [ ] **Step 6:** commit `test(e2e): bridge select → apply → tune flow and frame-time budget` and `docs: sync build plan and architecture with the bridge protocol`.

## PR slicing

| PR | Tasks | Waits for |
|---|---|---|
| A `feat/4-bridge-package` | 1–5 | nothing |
| B `feat/4-bridge-client` | 6–7 | Phase 3 on `main`, PR A |
| C `feat/4-bridge-integration` | 8–10 | Phases 2 and 3 on `main`, PRs A and B |

## Deferred items to log when implementation starts

Multi-origin allow-list for Render preview environments (P2, this-phase for launch); dedicated sandbox origin for cloned pages once the API has auth cookies (P1, later); context-provider half of DT-026 (P2, later); export wraps rules in `prefers-reduced-motion: no-preference` (Phase 7, pending spec §9 question 4); selection ring measures a stale rect while the element is mid-animation (P3); decorative `baseStyles` lose to more specific host rules in both preview and export (P3); keyboard navigation of the animation list (P3); close DT-060 (one `CatalogEntry` type in web) if Task 6 makes it trivial, otherwise leave open.

## Self-review

- Spec coverage: D1 → Tasks 1, 3, 6; D2 → 1, 8, 9; D3 → 4; D4 → 4, 7, 9; D5 → 2, 7, 10; D6 → 3, 4; D7 → 2, 7, 9; D8 → deferred list; D9 → planning PR; D10 and the element-switch guard → 5, 6, 7, 9, 10; §2 origin checks → 2, 7; cross-origin mock → 9; §6 budgets → 3 (no stylesheet write on param change), 4 (single observer), 10 (measurement); §6a parity → constants in Task 1, remainder is Phase 7; reserved messages (`mode`, `elements:query`, `elements:list`) are intentionally **not** implemented and unknown types are ignored (Task 2 test).
- Names are consistent across tasks: `AppliedAssignment`, `ElementInfo`, `toApplied`, `createEditorStore`, `createBridgeClient`, `BULK_APPLY_LIMIT`, `IN_VIEW_THRESHOLD`.
- Known softness, by design: Tasks 8–10 name Phase 2 and Phase 3 files as they exist on unmerged branches today. Task 0 exists to re-verify them; step-level code for those tasks is finalised at the seam check rather than guessed now.
