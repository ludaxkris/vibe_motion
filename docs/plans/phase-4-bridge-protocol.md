# Phase 4 — Bridge protocol spec (v1)

Status: v1, revised after `code-architect` review, owner decisions of 2026-09-18 folded in (§9) · Owner: Chris Tung · Written 2026-09-18 against `main` @ bb5cc23, Phase 2 worktree @ 014529e (PR #4, draft), Phase 3 worktree @ 645c25e (no PR yet).

This is the contract between the editor shell (`apps/web`) and the bridge script running inside the cloned page's iframe. It refines the message table in [build_plan.md §4 Phase 4](../build_plan.md). It is a **shared contract** (CLAUDE.md rule 5): changes after it lands are additive only. The implementation plan is [phase-4-bridge-plan.md](phase-4-bridge-plan.md).

Everything the build plan already decided stands: `postMessage` only, strict origin checks, overlay drawn inside the iframe, capture-phase click interception, one `<style id="vm-runtime">` block plus per-element inline styles, and live preview never calls the API. One build-plan detail changes: replay uses a synchronous style flush, not a next-frame toggle (see `replay` in §3).

## 1. Decisions this spec adds

| # | Decision | Why |
|---|---|---|
| D1 | **The bridge is a dumb renderer. The shell computes all CSS.** `apply` carries the finished keyframes name, keyframes CSS, inline style map and base styles. The bridge never sees the catalog and never builds a keyframes name. The bridge validates what it interpolates: `vmId` matches `/^vm-[a-z0-9-]+$/`, `keyframesName` matches `/^vm-[a-z0-9-]+$/`, every `style` key matches `/^(animation-(?!name$)[a-z-]+|--vm-[a-z0-9-]+)$/`; a message failing validation is acked `ok: false, error: "invalid-payload"` and ignored. | The frame's CSP is `connect-src 'none'`, so it cannot fetch a catalog. One generator (`apps/web/lib/runtime-css`) means the preview cannot drift from the help page, and DT-047's rule ("never build the name yourself") holds by construction. The full payload is under 1 KB (largest keyframes body in catalog 1.1.0 is 413 bytes), so resending it on every slider tick is cheap and a slimmer param-only message is not worth a second code path. |
| D2 | **The bridge source moves to a workspace package, `packages/bridge`.** `src/vm-bridge.js` (plain script, no imports, no build step, `// @ts-check` with JSDoc types from `protocol.ts`) and `src/protocol.ts` (types and constants). A Gradle `bridgeResources` Sync task copies the script into the API jar the way `catalogResources` copies the catalog (plus one Dockerfile `COPY packages/bridge`). The web mock route serves the same file. `BRIDGE_VERSION` lives only in the script; Kotlin parses it out instead of hand-syncing a constant. | Phase 2 has no JS test tooling under `apps/api`; the script is only string-asserted from Kotlin. A package gives it vitest + jsdom tests, a `tsc --checkJs` gate, and gives the mock-mode e2e path the *same* script the API serves. |
| D3 | **Triggers are armed by the bridge, not expressed as CSS selectors.** `--vm-*` custom properties are written inline as soon as an assignment is applied (they are inert on their own). The whole `animation-*` group (`animation-name`, every longhand in `style`, and `animation-play-state: running`) is written inline, all `!important`, **only while the trigger is armed**; disarming restores the snapshot (D6). `load` arms at once. `hover` arms on pointer enter and disarms on pointer leave, reusing the delegated pointer handlers that drive the hover outline. `in-view` arms and disarms from one shared `IntersectionObserver`; while it is **not** armed the element is *held on its first keyframe*: the group is written with `animation-play-state: paused`, `animation-delay: 0s` and `animation-fill-mode: both` (all `!important`), and arming rewrites the assignment's own delay and fill-mode with `running`. | Writing only `animation-name` late would leave our duration and delay retiming whatever animation the host page already runs on that element. `!important` on the whole group keeps our longhands coherent against host `!important` rules, including the common `prefers-reduced-motion` reset that would otherwise make the preview look dead. Avoids `:hover` rules fighting host specificity. Holding the first keyframe stops an entrance that starts at `opacity: 0` from showing, snapping to hidden, then fading in (owner decision, §9.3). Three clarifications, all measured in a real browser and none of them visible to jsdom: **(a)** every `in-view` arm-state transition, in both directions, must give the element a *new* animation (`animation-name: none`, one forced style flush for the whole batch, then the name back). Changing anything but `animation-name` updates a CSS animation in place, so toggling play-state on one that has already finished pauses it at its end rather than rewinding it; "held" therefore means a new animation paused at t=0, not the old one paused. **(b)** Hover arms the whole chain of tagged ancestors-or-self of the pointer target, because the page still considers a card hovered when the pointer is over a button inside it and the Phase 7 `:hover` rule would still match; the hover outline and `element:hover` stay nearest-only. **(c)** The armed group always contains *every* `animation-*` longhand: any the `style` map omits is written at its initial value (`duration 0s`, `timing-function ease`, `delay 0s`, `iteration-count 1`, `direction normal`, `fill-mode none`, plus `animation-timeline: auto` where supported). Otherwise a host `animation: spin 2s linear infinite` leaks its easing and its infinite iteration count into ours. |
| D4 | **`preview` / `preview:clear` are separate from `apply` / `clear`.** A preview is transient, never touches the draft, and clearing it restores whatever was applied before. A preview also sits out the trigger's arm transitions: an `in-view` element scrolled in or out while a preview is on it keeps showing the preview, and `preview:clear` then renders whatever arm state it reached in the meantime. | The handoff previews an animation on hover of a catalog card. Modelling that as apply-then-undo in the shell would dirty the draft and race with real edits. |
| D5 | **Every shell→iframe message carries `seq`; the bridge answers `ack { seq, ms }`.** `ms` is the time the bridge spent in the handler. | Gives tests a deterministic thing to await, and gives the performance criterion a number taken inside the frame. |
| D6 | **The bridge restores what it overwrites.** Per element the bridge keeps three layers: `original` (the host's inline value and priority for each property we touch, snapshotted **once**, never while the bridge owns the property), `applied`, and `preview`. One `render(element)` function writes `preview ?? applied` according to arm state. A key present in the old `style` map and absent from the new one is restored from `original`. An `apply` that arrives during a preview updates `applied` only. Keyframes used by a preview take part in the reference count. | Cloned pages keep their own inline styles. Removing our properties must not remove theirs, and a preview must never snapshot our own applied values as "original". |
| D7 | **Handshake with a protocol version.** `ready` carries `protocolVersion: 1`. The shell sends `hello` when the client mounts and on the iframe's `load` event; the bridge answers `hello` by re-sending `ready`. The shell treats `ready` as idempotent: each one rejects pending acks and triggers a fresh `state:load`. On a `protocolVersion` it does not know, the shell sends nothing and shows a reload banner. | The editor shell is server-rendered, so the iframe starts loading before hydration and the first `ready` can fire before the shell listens. Without `hello` the shell would queue forever. A bridge with **no usable parent origin** (the attribute is missing, or does not parse as a URL, or `window.parent === window`) stays completely inert: it installs no overlay, no crosshair and no click or submit interception, so a cloned page opened directly in a tab is still an ordinary page. The attribute is normalised once with `new URL(value).origin`, so a `WEB_ORIGIN` with a trailing slash cannot produce a bridge that handshakes and then silently drops every inbound message. A `hello` the bridge cannot answer yet, because the document has no `<body>` to scan, is acked `ok: false` with no error code and posts no `ready`: the shell must never read a `hello` ack as proof that a `ready` followed. It needs no recovery path, because the `ready` at `DOMContentLoaded` and the `hello` it re-sends on the iframe's `load` event both still arrive. |
| D8 | **Single allowed origin per side in v0.** Multi-origin support (Render preview URLs) is deferred. | Phase 2's `WEB_ORIGIN` is singular end to end. |
| D9 | **Message types stay unprefixed** (`apply`, not `vm-apply`). | The envelope's `source: "vibe-motion"` already namespaces them and the build plan uses unprefixed names. CLAUDE.md's naming rule lists "message type" among `vm-` prefixed things; that line is amended in the same PR (owner decision, §9.5). |
| D10 | **The bridge never moves the selection ring on its own.** A click only *reports* `element:select`; the ring moves when the shell answers with `select`. | The shell may refuse a selection change: switching away from an element whose animation was added or changed opens the unsaved-changes guard first (owner decision, §9.1). If the bridge moved the ring optimistically, the ring and the panel would disagree while the dialog is open. |

## 2. Envelope

```ts
type Envelope<T extends string, P> = {
  source: "vibe-motion";
  type: T;
  payload: P;
  seq?: number; // shell→iframe only: monotonically increasing per shell session
};
```

A receiver drops a message silently unless **all** of these hold:

| Check | Bridge (inside iframe) | Shell |
|---|---|---|
| Origin | `event.origin === parentOrigin` (from `data-vm-parent-origin`, i.e. `WEB_ORIGIN`) | `event.origin === new URL(previewPageUrl(projectId), location.href).origin` |
| Window | `event.source === window.parent` | `event.source === iframe.contentWindow` |
| Shape | `data && data.source === "vibe-motion" && typeof data.type === "string"` | same |
| Known type | unknown `type` is ignored (forward compatibility) | same |

Senders always pass an explicit `targetOrigin`; `"*"` is forbidden on both sides. The clone pipeline strips iframes and meta refresh and the page CSP sets `frame-src 'none'`, so no nested frame can spoof `ready`.

**Mock mode stays cross-origin.** With `NEXT_PUBLIC_API_MOCKING=enabled` the shell runs on `http://localhost:3000` and the iframe `src` is `http://127.0.0.1:3000/mock-api/projects/<id>/page`: the same Next server, a different origin. The mock route injects `data-vm-parent-origin="http://localhost:3000"` and sends the same CSP as Phase 2's `BridgePageRenderer`. A same-origin mock would let a bridge that skips its origin check pass e2e.

## 3. Messages

### iframe → shell

| Type | Payload | When |
|---|---|---|
| `ready` | `{ elementCount: number; bridgeVersion: string; protocolVersion: 1 }` | At `DOMContentLoaded`, and again in answer to every `hello`. |
| `element:hover` | `ElementInfo \| { vmId: null }` | When the hovered tagged element **changes** (not on every mouse move). `vmId: null` when the pointer leaves all tagged elements. |
| `element:select` | `ElementInfo` | Capture-phase `click` on or inside a tagged element (nearest ancestor-or-self with `data-vm-id`). The click is always `preventDefault`-ed and never navigates. It is a request: the ring does not move until the shell sends `select` (D10). |
| `element:deselect` | `{ reason: "escape" \| "background" }` | `Escape` keydown inside the frame, or a click that resolves to no tagged element. The shell decides whether to honour it. |
| `ack` | `{ seq: number; ms: number; ok: boolean; error?: "unknown-element" \| "invalid-payload"; unknownVmIds?: string[] }` | After handling any message that carried `seq`. `state:load` with a valid payload always acks `ok: true` and carries `unknownVmIds`, the vmIds it could not place (empty when there were none): a bulk load is not fatal when the page has moved on, so it applies what it can and names the rest. A single `apply`, `clear`, `select` or `replay` naming an element the page does not have still acks `ok: false, error: "unknown-element"`. |
| `elements:list` *(bridge ≥ 1.1.0)* | `{ seq: number; elements: ElementInfo[]; truncated: boolean; viewport: { width: number; height: number } }` | Answer to `elements:query`, posted **before** that query's `ack`. `seq` is the query's envelope `seq`. `viewport` is the frame's `innerWidth` / `innerHeight`, so the receiver can tell above-the-fold (`pageRect.y < viewport.height`) from below. Rules under "`elements:query` rules" below. |

```ts
type Rect = { x: number; y: number; width: number; height: number };
type ElementInfo = {
  vmId: string;
  tag: string;            // lower-case
  role: string | null;    // explicit role attribute, else null
  textPreview: string;    // textContent, whitespace-collapsed, max 80 chars
  rect: Rect;             // iframe viewport, CSS px
  pageRect: Rect;         // document coordinates, CSS px
  order: number;          // document order among tagged elements, from 0
  visible: boolean;       // non-zero box and not visibility:hidden / display:none
};
```

### shell → iframe

| Type | Payload | Effect |
|---|---|---|
| `hello` | `{}` | The bridge re-sends `ready`. |
| `select` | `{ vmId: string \| null; label?: string; scrollIntoView?: boolean }` | Draws or removes the selection ring. `label` is the tag text shown on the ring (`h1 · Fade In Up`); default is the element's tag. |
| `apply` | `AppliedAssignment` | Creates or updates the assignment on `vmId`. Replays once when `keyframesName`, `trigger` or `baseStyles` changed; a param-only change does not restart the animation. |
| `clear` | `{ vmId: string }` | Removes the assignment and restores overwritten inline values (D6). |
| `replay` | `{ vmId: string \| null }` | Restarts the animation on one element, or on all when `null`: arm if needed, set `animation-name: none`, force a style flush (`getComputedStyle(el).animationName`), restore the name, all in the same task. For `hover` and `in-view` this plays the animation once and then returns to the trigger's normal arm state. That one forced play ends on the element's **own** `animationend`, on its first `animationiteration`, or on a matching `animationcancel`, matched by both `event.target === el` and `event.animationName === keyframesName` and never by a timer. Both halves of that matching are load-bearing: `animationend` bubbles, so a host spinner finishing inside the element would otherwise strip the group mid-play, and a looping animation never fires `animationend` at all. An `animationcancel` counts only when no animation of that name is live on the element any more (`getAnimations()`, where the engine has it): restarting an animation cancels the outgoing one and the event is delivered a frame later, once the replacement is already running, so a cancel with a live animation behind it is one the bridge caused itself. `clear` and `state:load` end a forced replay directly rather than waiting for an event. A payload with no `vmId` key is `invalid-payload`; only an explicit `null` means every element. |
| `preview` | `AppliedAssignment` | Shows an assignment transiently on `vmId` and plays it once regardless of trigger. At most one preview exists; a new one replaces it. |
| `preview:clear` | `{}` | Removes the preview and re-renders the element from its applied assignment, if any. |
| `state:load` | `{ assignments: AppliedAssignment[] }` | Clears every assignment and preview, then applies the list in one batch (one stylesheet rebuild). Used after `ready`, on Cancel, for bulk changes, and by version viewing in Phase 6. |
| `mode` *(reserved, Phase 6)* | `{ mode: "edit" \| "view" }` | `view`: no hover outline, no crosshair, no select events. |
| `elements:query` *(bridge ≥ 1.1.0)* | `{ filter?: { tags?: string[]; minWidth?: number; minHeight?: number }; limit?: number }` | One read-only layout pass; answered by `elements:list`, then the normal `ack`. Rules under "`elements:query` rules" below. |

```ts
type AppliedAssignment = {
  vmId: string;
  trigger: "load" | "hover" | "in-view";
  keyframesName: string;              // from keyframesName(); e.g. "vm-fade-in-up-v1-1-0"
  keyframesCss: string;               // full "@keyframes <name> { ... }" block
  style: Record<string, string>;      // animation-* longhands and --vm-* custom properties; never animation-name
  baseStyles: string;                 // catalog baseStyles declarations, "" when none
  animationId: string;                // informational
  catalogVersion: string;             // informational
  params: Record<string, string>;     // informational
};
```

#### `elements:query` rules

Added in Phase 5 (`docs/plans/phase-5-agent-flows.md` §3). Additive: `PROTOCOL_VERSION` stays `1` and `BRIDGE_VERSION` becomes `1.1.0`. A bridge older than `1.1.0` ignores the type like any unknown one (no list, no ack), so the shell checks `ready.bridgeVersion` before it asks.

- `elements:query` must carry a finite envelope `seq`; without one (missing, not a number, `NaN`, `Infinity`) the bridge acks nothing and posts nothing, because the answer could not be correlated (`NaN !== NaN`). With one it posts `elements:list` (payload `seq` = envelope `seq`) and then the normal `ack`. `protocol.ts` exports `ElementsQueryEnvelope`, the envelope type with `seq` mandatory. (Since 1.1.0 no message with a non-finite `seq` is acked, for the same reason; the message itself is still handled.)
- Elements are listed in document order. `filter.tags` are tag names, lower-cased by the bridge before matching; every entry must be a string. `tags: []` is a filter nothing passes (`ok: true`, empty list), not "no filter"; omit `tags` for that. An element matches a filter that contains `"button"` when its `role` attribute, read as a whitespace-separated token list, contains `button` (`role="button link"` matches). `minWidth` / `minHeight` compare against the border box (`getBoundingClientRect`). `limit` defaults to `ELEMENTS_QUERY_LIMIT = 200` and is clamped to `[1, ELEMENTS_QUERY_MAX = 500]` (a fractional limit is floored); `truncated` is true when more matched.
- Only elements with `visible === true` are listed, and `visible` means exactly: a non-zero box, and a computed style that is neither `visibility: hidden` nor `display: none`. It does **not** mean the designer can see the element: `opacity: 0`, an off-canvas drawer, an `.sr-only` label at `left: -9999px` and an element clipped by an ancestor all still count. Overlay nodes are never listed (they are not tagged).
- Rects are the **transformed** box, as `getBoundingClientRect` reports it. An element the bridge is holding on its first keyframe (`in-view`, not yet armed, D3) is measured in that pose: a slide-in measures displaced by its distance, a flip or a scale-from-zero can measure zero-height and so drop out as not visible. A caller that re-queries a page with assignments applied should prefer the `ElementInfo` it remembered from before they were applied (the Phase 5 shell does).
- Malformed payload → `ack { ok: false, error: "invalid-payload" }` and no list: a payload that is a string, a number or an array; a `filter` that is not a plain object (arrays included); `tags` that is not an array or has a non-string entry; sizes or a limit that fail `typeof x === "number" && isFinite(x)` (`NaN` would otherwise disable the limit). A missing or `null` payload is an empty query.
- One layout pass: every `getBoundingClientRect` happens in one loop with no style writes in between; the handler writes nothing at all, with or without a selection (the overlay re-sync the bridge schedules after every message runs in a later frame, outside the handler and outside `ack.ms`). `filter.tags` is checked against `el.tagName` / `role` **before** the element is measured, so a non-matching element is never measured and its `textContent` is never read. This matters because the clone tags *every* element under `<body>`: the filter, not the limit, is what selects targets.
- **Cost.** `limit` caps the results, not the scan. A query without `tags` measures every tagged element and reads every wrapper's whole-subtree `textContent`: O(elements + total text × depth), outside the §6 budget. The shell must not send an untagged query on a large page.

**Versioning.** Feature detection is by `ready.bridgeVersion`, compared numerically as semver (`"1.10.0" > "1.2.0"`; a string compare gets that wrong). `PROTOCOL_VERSION` changes only for breaking changes; additive messages like this pair bump `BRIDGE_VERSION` alone.

The shell builds an `AppliedAssignment` from a draft `Assignment` with `getEntry(assignment.catalogVersion, assignment.animationId)` from the `animation-catalog` package and `apps/web/lib/runtime-css`. An assignment whose pinned version or id cannot be resolved is **not sent**; the shell reports it in the panel. Each assignment resolves against its own pin, so a draft that mixes catalog versions renders correctly.

## 4. What the bridge writes into the page

| What | Where | Changes when |
|---|---|---|
| `@keyframes` blocks, one per distinct `keyframesName` in use (reference-counted by vmId, previews included) | `<style id="vm-runtime">` | an assignment is added, removed, or changes animation. **Never on a param change.** |
| `[data-vm-id="<vmId>"] { <baseStyles> }`, one rule per assignment with non-empty `baseStyles` | `<style id="vm-runtime">` | same as above |
| `--vm-*` entries of `style` | the element's inline `style` (`style.setProperty`) | every `apply` |
| `animation-*` group: `animation-name`, the longhands in `style`, `animation-play-state: running` | inline, `!important`, **only while armed** | trigger events, `apply` while armed, `replay`, `preview` |
| Hover outline, selection ring and its label | one fixed-position container `<div data-vm-overlay>` appended to `<body>`, `pointer-events: none` | hover / `select`; repositioned in `requestAnimationFrame` from a capture-phase passive `scroll` listener (nested scrollers do not bubble) and from `resize` |

`vm-runtime` is mutated **through CSSOM**, never by writing text into the element: `insertRule` for each `@keyframes` body and for each base-styles rule, `rule.style.cssText` for the declarations. `keyframesCss` must parse to exactly one `@keyframes` rule whose name is the `keyframesName` in the same payload, and a name already in use arriving with a different body is rejected; either failure acks `invalid-payload`. A declaration list cannot escape its rule, so `baseStyles` cannot reach another selector. The bridge creates its own `<style id="vm-runtime">` and never adopts one the page already carries, because a page Vibe Motion exported earlier and that was then re-cloned brings that id with live host CSS in it.

The crosshair is not an inline style on `<html>`: the bridge sets `data-vm-mode="edit"` on the root and keeps `:root[data-vm-mode="edit"], :root[data-vm-mode="edit"] * { cursor: crosshair !important }` in `vm-runtime`. An inherited inline value loses to the UA's `cursor: pointer` on exactly the links and buttons a designer clicks most, and Phase 6's reserved `mode` message becomes one attribute flip.

The overlay container and everything in it is excluded from hit-testing and from `[data-vm-id]` queries. Visuals follow the design handoff: hover is a 1.5px dashed `#7c5cff` outline; selected is a 2px solid ring offset about 6px with a mono tag label; the cursor over the page is `crosshair`.

## 5. Shell-side behaviour

- The bridge client lives in `apps/web/lib/bridge/` and is framework-free: it takes a target `Window`, the expected origin, and an editor store instance. The store module exports `createEditorStore()` so tests get a fresh store; the context provider half of DT-026 stays deferred. A thin React hook mounts the client on the iframe.
- **Inbound:** `element:select` → `requestSelect(vmId)` plus the `ElementInfo` kept in a side map; `element:hover` → `hoverVmId`; `element:deselect` → `requestSelect(null)`.
- **Unsaved-changes guard on element switch.** The currently selected element is *dirty* when its draft assignment differs from `currentVersionState` for that vmId (added, changed or removed). `requestSelect(next)`: same element → no-op; selected element clean → select `next` and send `select`; selected element dirty and `next` is another element → keep the selection, remember `pendingSelectVmId = next`, open the guard dialog ("Save changes to h1?"); selected element dirty and `next` is `null` (Escape or background click) → do nothing, as the handoff specifies. Guard outcomes: **Discard** reverts that one element to its `currentVersionState` entry (sends `apply` or `clear`), then selects the pending element; **Keep editing** drops the pending selection; **Save** runs the Save flow and then selects the pending element. The Save flow itself is Phase 6; Phase 4 exposes it as an injected `onSave` seam and renders the button disabled with the tooltip "Saving arrives with version history" until Phase 6 supplies it.
- A consequence for Phases 5 and 6: outside page-level auto-generate, at most one element is dirty at a time, so a saved version normally carries a one-element diff.
- **Outbound:** a store subscription diffs `draftState` by reference per vmId. Changes are coalesced per vmId per `requestAnimationFrame`: `apply` for changed entries, `clear` for removed ones. More than 8 changed entries in one update sends a single `state:load` instead (this is what Phase 5 auto-generate produces). When a slider is released (pointer up) the shell sends `replay` so the designer sees the result. Selection changes send `select`. Nothing here calls the API.
- The iframe gets `sandbox="allow-scripts allow-same-origin"`. `allow-same-origin` keeps the framed document on its own origin so the origin check and `script-src 'self'` work; dropping it would make the frame's origin `"null"` and force a `"*"` target. Because both real and mock mode are cross-origin with the shell, the pair never lets the frame reach the shell's DOM.

## 6. Performance budget

| Path | Budget | How it is met / measured |
|---|---|---|
| Param change (slider tick) | shell-side round trip (store set → `ack` received) p95 < 16 ms; max `ack.ms` < 4 ms | inline `setProperty` calls only, no stylesheet write, no layout read. Measured in Playwright with 120 rAF-paced `updateDraftParam` ticks under CDP 4× CPU throttling. p95, not max, because CI is noisy. |
| `state:load`, 200 assignments | `ack.ms` < 50 ms | one stylesheet text write; style writes batched; no per-assignment layout read |
| `elements:query`, **tag-filtered** (the Phase 5 filter: `h1`–`h6`, `p`, `li`, `blockquote`, `img`, `picture`, `video`, `figure`, `article`, `button`, `a`; min 40×40), 2,000-element page | p95 `ack.ms` < 50 ms with guaranteed-dirty layout, zero style writes | tag/role pre-filter before any measurement; one read-only loop. Measured in `packages/bridge/e2e` on a generated page (2,121 tagged elements, the ~300 KB of text inside nested `<article>` wrappers, which the filter matches) at `limit` 200, at the 500 ceiling, and with sizes nothing reaches (full scan), 40 runs each clean and 40 with the whole page's layout invalidated in the same task as the query, so no frame can flush it first. p95, not max, because CI is noisy. A `MutationObserver` asserts no write. An untagged query is outside this budget (§3). |
| Element lookup | O(1) | the bridge builds a `Map<vmId, Element>` once at `ready`; no attribute-selector scans per message |
| Hover | no message unless the target vmId changes; overlay moves in rAF | avoids flooding `postMessage` on mouse move |
| `in-view` | one shared `IntersectionObserver` for all in-view assignments | threshold is the exported constant `IN_VIEW_THRESHOLD = 0.2` in `protocol.ts`, reused by the Phase 7 exporter |

## 6a. Preview / export parity

Phase 7's exporter must render what the designer saw. Where the editor deliberately differs, it is listed here.

| Aspect | Editor preview (Phase 4) | Export (Phase 7) |
|---|---|---|
| Keyframes name and body | from `keyframesName()` and the pinned catalog entry | same |
| `baseStyles` selector specificity | `[data-vm-id="…"]` = (0,1,0) | `.vm-aN` = (0,1,0); both lose equally to a more specific host rule |
| `in-view` threshold | `IN_VIEW_THRESHOLD` | same constant |
| `in-view` repeats | re-arms on every entry, so the designer can see it again by scrolling (deliberate divergence) | plays once |
| `in-view` state before the trigger fires | held on the first keyframe: `paused`, delay `0s`, fill-mode `both` (D3) | same rule, in CSS: `.vm-aN:not(.vm-play) { animation-play-state: paused; animation-delay: 0s; animation-fill-mode: both; }` |
| `prefers-reduced-motion` | preview always plays | rules wrapped in `@media (prefers-reduced-motion: no-preference)`; without it the element simply shows in its resting state (Phase 7, deferred-task entry) |
| Absent `animation-*` longhands | written inline at their initial values, so the host's cannot leak in (D3) | the exporter emits the `animation` **shorthand**, which resets every longhand it does not set, for the same reason |
| `!important` | on the inline `animation-*` group | never (build plan §6) |

## 7. Out of scope for Phase 4

Generate and Auto-generate (Phase 5), the Save flow and the guards on leaving the editor, viewing a version and exporting (Phase 6; `mode` is only reserved here; the element-switch guard **is** in Phase 4, §5), multi-origin allow-lists, serving clones from a dedicated sandbox origin (needed once the API has auth cookies), keyboard navigation of the catalog list, and any message that writes to the API.

## 8. Sequencing constraint

`packages/bridge` and the framework-free client in `apps/web/lib/bridge` do not touch any file the in-flight Phase 2 or Phase 3 branches own, but the client imports the Phase 3 store. Moving the script out of `apps/api` resources, the Gradle and Dockerfile changes, the iframe `sandbox` change and the mock route change all edit Phase 2 or Phase 3 files and wait for those merges (CLAUDE.md rule 11).

## 9. Owner decisions (Chris, 2026-09-18)

1. **Guard on element switch: yes.** If an animation was added or changed on the selected element, clicking another element shows the unsaved-changes dialog before the selection moves (§5, D10). This overrides the first draft's "no guard" assumption.
2. **`in-view` re-arms on every entry in the editor**; the export plays once. Recorded in §6a as a deliberate divergence.
3. **`in-view` elements are held on their first keyframe until the trigger fires**, in preview and export (D3, §6a).
4. **Reduced motion:** the editor preview always plays; the export wraps its rules in `@media (prefers-reduced-motion: no-preference)` (§6a; Phase 7 deferred-task entry).
5. **Message types stay unprefixed**; CLAUDE.md's naming rule is amended in the same PR (D9).
