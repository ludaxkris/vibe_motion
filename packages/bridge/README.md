# bridge

The preview bridge: the script that runs **inside the cloned page's iframe**, plus the
`postMessage` protocol types and constants that the editor shell, the API and the Phase 7
exporter share.

Contract: [`docs/plans/phase-4-bridge-protocol.md`](../../docs/plans/phase-4-bridge-protocol.md).
It is a shared contract (CLAUDE.md rule 6): additive changes only.

## What is in here

| File | What |
|---|---|
| `src/vm-bridge.js` | The bridge itself. One IIFE, `"use strict"`, `// @ts-check`, no imports, no exports, **no build step**. |
| `src/vibe-motion-export.js` | The `vibe-motion.js` an **export** ships (Phase 7). Same shape as the bridge — one IIFE, classic script, no build step — but it talks to nobody and knows nothing: it adds `vm-js` to `<html>` and releases `.vm-in-view` elements as they are scrolled to. |
| `src/protocol.ts` | Message types, `AppliedAssignment`, `ElementInfo`, the validation regexes, `IN_VIEW_THRESHOLD`, `BULK_APPLY_LIMIT`, `ELEMENTS_QUERY_LIMIT` / `ELEMENTS_QUERY_MAX`. |
| `test/harness.ts` | `loadBridge(html)` — builds a JSDOM, stubs `window.parent`, evaluates the script and hands back a controllable frame (fake `IntersectionObserver`, fake `requestAnimationFrame`, recorded posts). |
| `e2e/harness.ts` | `mountBridge(page, body)` — the same script in a real browser: the test page is the shell on one origin, the framed page is the clone on another, and a third origin hosts a frame that tries to talk to the bridge. Everything is fulfilled by `page.route`, so there is no app and no API to start. Also `mountExport(page, …)`, which serves an exported page — `index.html`, `vibe-motion.css`, `vibe-motion.js` — on an origin of its own, optionally inside a cross-origin iframe. |

`vm-bridge.js` is a **plain classic script**, not a module. It is loaded into someone else's page
under a CSP of `script-src 'self'; connect-src 'none'`: no `eval`, no injected inline script, no
network call. It cannot `import` `protocol.ts`, so it duplicates the three validation regexes and
the shared constants, and `typecheck` (tsc with `checkJs`) checks it against the JSDoc types;
`test/protocol.test.ts` ("parity with the bridge script") and `test/render.test.ts` assert the
two copies are identical.

The bridge is a **dumb renderer** (spec D1): the shell computes every byte of CSS and sends it in
an `AppliedAssignment`. The bridge never reads the catalog and never builds a keyframes name.

### Element discovery (`elements:query` → `elements:list`, bridge ≥ 1.1.0)

The one read-only message pair, added for Phase 5's agent (spec §3, "`elements:query` rules").
The shell sends `{ filter?: { tags?, minWidth?, minHeight? }, limit? }` **with a `seq`** and gets
back `elements:list { seq, elements: ElementInfo[], truncated, viewport }`, then the ack.

- **Send a finite `seq`.** Without one nothing is posted, not even an ack. Type the outgoing
  message as `ElementsQueryEnvelope` and the compiler enforces it. A bridge older than 1.1.0
  ignores the type entirely, so check `ready.bridgeVersion` first (numeric semver compare, not a
  string compare) and time out rather than wait. `PROTOCOL_VERSION` only moves on breaking changes.
- **Always send `tags`.** The tag/role filter runs before any measurement, and it is what the
  50 ms budget is about: a clone tags every element under `<body>` and `textPreview` reads the
  whole subtree's `textContent`, so an untagged query costs O(elements + text × depth) and
  `limit` does not bound it (it caps results, not the scan).
- `tags` entries must be strings and are lower-cased; `tags: []` matches **nothing** (omit `tags`
  for "any tag"); `"button"` also matches an element whose `role` tokens include `button`
  (`role="button link"`).
- Listed = `visible === true`, which means a non-zero box that is not `visibility:hidden` /
  `display:none`. It does not mean on screen: `opacity: 0`, off-canvas and clipped elements are
  still listed. Document order.
- **Rects are the element's RESTING box** — `rect`, `pageRect`, the size floor and `visible` alike,
  for `elements:list`, `element:select` and `element:hover`. With nothing of ours applied to the
  element or an ancestor it is exactly `getBoundingClientRect()`; with something applied (any
  trigger, any play state, previews included) it is the layout box, because an `in-view` element
  held on its first keyframe measures displaced, shrunken, or zero-height and drops out of the
  list altogether — and a transform applies to the whole subtree, so an untouched child of a held
  block is distorted too. The bridge is the single source of truth: do **not** substitute an
  `ElementInfo` you remembered from before the assignments were applied.
- `limit` defaults to `ELEMENTS_QUERY_LIMIT` (200), clamped to `[1, ELEMENTS_QUERY_MAX]` (500).
- `invalid-payload`, no list: a string / number / array payload, a non-object or array `filter`,
  non-array `tags` or a non-string entry, any non-finite number. Missing or `null` payload = `{}`.
- The handler writes nothing, selection or not. `e2e/` holds p95 `ack.ms` under 50 ms on a
  2,000-element page with layout invalidated in the same task as each query.

Everything it injects into the page is prefixed:

| Injected | What |
|---|---|
| `<style id="vm-runtime">` | every `@keyframes` body in use (reference-counted), one `[data-vm-id="…"] { … }` base-styles rule per assignment, and the crosshair rule. Always the bridge's own element, mutated through CSSOM (`insertRule` / `rule.style.cssText`), never by writing text |
| `data-vm-mode="edit"` on `<html>` | what the crosshair rule keys on; Phase 6's reserved `mode` message is one attribute flip |
| `<div data-vm-overlay>` | the fixed, `pointer-events: none` container holding the hover outline and the selection ring |
| `data-vm-overlay-hover` / `data-vm-overlay-ring` / `data-vm-overlay-label` | the hover outline, the selection ring, and the ring's own label, so a test or a screenshot can name what it means instead of counting children |
| `data-vm-hovered` / `data-vm-selected` on that container | the vmId the outline and the ring are currently drawn around; the bridge's only readable state, which is how the tests and the Phase 4 e2e spec assert that a click did **not** move the ring (spec D10) |
| `--vm-*` custom properties, `animation-*` longhands | inline on the element, the animation group `!important` and only while the trigger is armed. The group is always *whole*: any longhand the payload omits is written at its initial value, so the host's cannot leak in |

The one thing that is **not** `vm-` prefixed is the `postMessage` type names (`apply`, not
`vm-apply`): the envelope's `source: "vibe-motion"` namespaces them, per spec D9 and the amended
naming rule in CLAUDE.md.

## The export runtime (`src/vibe-motion-export.js`)

The only JavaScript an exported page ever gets, and only when some assignment uses the `in-view`
trigger — `load` and `hover` are plain CSS. The API returns the file **unchanged**: nothing is
interpolated into it, ever, which is what makes it something a reviewer can read once.

- Adds `vm-js` to `<html>` **immediately**. Every `in-view` rule in `vibe-motion.css` is scoped to
  `:where(.vm-js)`, so a page without this file rests in its normal state instead of being stranded
  on a first keyframe of `opacity: 0`. The `<script>` is in `<head>` and **not deferred** for that
  one line: the class has to be set before the first paint.
- At `DOMContentLoaded`, one `IntersectionObserver` at `threshold: [0, IN_VIEW_THRESHOLD]` watches
  every `.vm-in-view`, and a `MutationObserver` on `documentElement` picks up marked elements that
  arrive later — snippet mode is pasted into sites that render on the client.
- An entry fires when `isIntersecting && (intersectionRatio >= T || reachable < T)`, where
  `reachable = min(1, rootW/w) * min(1, rootH/h)` is the largest ratio the element could ever
  attain. That second clause is DT-095: `intersectionRatio` is an **area** ratio, so an element
  big enough can never reach `T` at all and would stay held for ever. Area, not height — a 4000px
  track in a horizontal scroller tops out at 0.16 with a perfectly ordinary height. `rootBounds`
  is null when the exported page is itself in a cross-origin iframe, so the viewport stands in for
  both axes; reading off null would throw and leave everything held.
- On firing it adds `vm-play` and unobserves, so the animation plays **once** — a deliberate
  divergence from the preview, which re-arms on every entry (spec §6a).
- **Nothing may be left held at `opacity: 0`.** No `IntersectionObserver`, a constructor that
  throws, a callback that throws: every one of those plays everything.

## How it is consumed

- **`apps/api`**: a Gradle `bridgeResources` Sync task copies `src/vm-bridge.js` into the jar the
  way `catalogResources` copies the catalog, and `BridgeAssets.kt` parses `BRIDGE_VERSION` out of
  the script instead of hand-syncing a Kotlin constant. Ktor serves it at `/bridge/vm-bridge.js`
  and `BridgePageRenderer` injects
  `<script src="/bridge/vm-bridge.js" data-vm-parent-origin="<WEB_ORIGIN>" defer>`.
  A second Sync task, `exportScriptResources`, does the same for `src/vibe-motion-export.js`;
  `InViewScript.kt` reads it and the exporter puts it in the bundle's `js` field verbatim.
- **`apps/web`**: imports the types and constants as TypeScript source —
  `import type { AppliedAssignment } from "bridge"`, with `transpilePackages: ["bridge"]` in
  `next.config.ts` because there is no `dist/` — and drives the channel from
  `apps/web/lib/bridge` (`toApplied` builds the payloads, `createBridgeClient` is the shell half
  of the protocol). Its mock page route serves the very same `src/vm-bridge.js` file, so mock-mode
  e2e exercises the script the API ships.

### Why TS source and not `dist/`

`package.json` `exports` point straight at `src/protocol.ts` and `src/vm-bridge.js`; there is no
build script. `animation-catalog` points at a `dist/` because its `src/` is generated and it needs
`tsc` to emit `.d.ts` for the generated schema types — but that `dist/` is gitignored and no app
resolves this repo's packages by name today (`apps/web` reads the catalog's `versions/*.json` by
relative path). `bridge` has no generated sources and one hand-written types file, so shipping TS
source keeps the file the API serves and the file the tests run byte-identical, with nothing to
rebuild. `apps/web` uses `moduleResolution: "bundler"`, which resolves a `.ts` entry point fine.

## Running it

```bash
pnpm --filter bridge test        # vitest; each case gets its own JSDOM via test/harness.ts
pnpm --filter bridge typecheck   # tsc --checkJs over protocol.ts, vm-bridge.js and the tests
pnpm --filter bridge e2e         # playwright, Chromium; needs `playwright install chromium` once
pnpm gates:bridge                # all three, the way CI runs them
node --check packages/bridge/src/vm-bridge.js   # it still parses as a classic script
```

## Which suite proves what

jsdom has no layout, no real animations and no `IntersectionObserver`. Three of the behaviours
the spec turns on are therefore invisible to it, and the first review of this package found all
three wrong while every jsdom test passed. So `e2e/` exists for exactly that class:

| Only provable in `e2e/` | Why jsdom cannot see it |
|---|---|
| `in-view` holds at the first keyframe, plays, holds again, plays again | needs a real animation with a real `currentTime` and real `animationstart` events |
| a forced `replay` ends on its own animation, not a descendant's, and after one iteration when looping | jsdom never fires `animationend` or `animationiteration` |
| a hover-armed card stays armed over a tagged child | needs real pointer movement over a real layout |
| the host's `animation` shorthand survives a round trip, and its longhands do not leak in | jsdom's CSSOM does not expand the shorthand at all |
| the preview plays through a host `prefers-reduced-motion` reset | needs a real cascade |
| the selection ring tracks a nested scroller | `getBoundingClientRect()` returns zeros |
| the ring keeps marking the resting box through a page scroll, a nested scroll, a reflow above the element and a viewport change while an `iteration: infinite` animation runs | needs real layout, a real transform, a real `ResizeObserver` and an animation that really never ends; jsdom's version of this (`test/selection.test.ts`) can only assert the arithmetic against stubbed `offset*` and `getBoundingClientRect()` |
| a message from a third origin is never acked | needs three real origins |
| `baseStyles` and `keyframesCss` cannot escape their rules | needs a real CSS parser |
| `elements:query` returns real rects, skips `display:none`, reports the viewport, and meets its 50 ms budget on 2,000 elements | `getBoundingClientRect()` returns zeros, so jsdom tests stub it per element |
| the export runtime holds, plays once, fires for an element taller than five viewports, survives a null `rootBounds` in a cross-origin iframe, and plays everything when the observer is missing or throws | no `IntersectionObserver`, no `rootBounds`, no layout and no `currentTime` |

Still unproven anywhere, and worth knowing:

- `ElementInfo.rect` / `pageRect` / `visible` on `element:hover` / `element:select` are exercised
  but never meaningfully asserted (`visible` is always `false` under jsdom). The same function
  builds `elements:list`, where `e2e/` does assert them.
- Where the overlay boxes actually land: which element they are drawn around is asserted through
  `data-vm-hovered` / `data-vm-selected` and the ring's rect is checked in `e2e/`, but the 6px
  offset and the label position are not.
- Only Chromium is in the gate. The review measured the same behaviour in WebKit and Firefox by
  hand; nothing re-checks them per commit.

## Known limits

- **Elements with no offset box (`<svg>`, MathML).** They are not `HTMLElement`s, so the layout-box path cannot serve them. Their ring is always measured live: during an animation it follows the animated box (a spinning logo's ring breathes with the rotation) instead of marking the resting box. It is never empty and it tracks scroll and layout. The same applies to `elements:list` / `element:select` / `element:hover`: such an element is measured live whatever is applied, so a held one can still measure zero and drop out of a list (DT-200).
- **The layout box's own limits now reach `elements:list`, for touched subtrees only.** While any of
  our animations is applied to an element or an ancestor, that element's reported rect comes from
  the layout box rather than the live one — so it is integer-snapped (edges up to 0.75 px from the
  live rect, which is why a consumer comparing a remembered live rect with a fresh layout one needs
  a tolerance: `apps/web/lib/agent/targets.ts` uses 1.5 px), it does not see a **host ancestor's**
  own `transform` (a page that scales a wrapper reports the un-scaled size, DT-198), and it reports
  the first fragment of a wrapped inline rather than the union. Unlike the ring, this path applies
  no remembered correction: a correction belongs to one selected element, and a query measures
  hundreds. An untouched page is unaffected — it is measured live and exactly.
- **Duplicate `data-vm-id` in a clone.** The element map keeps the first element with a given
  vmId, so inline styles land only on that one, but the `[data-vm-id="…"] { … }` base-styles rule
  matches every copy, and `clear` restores only the first. The clone pipeline is what should
  guarantee uniqueness; the bridge does not police it.

- **How the overlay finds the resting box while our animation runs.** The ring marks the box the
  element rests at, and keeps marking it through scrolls, resizes and reflows — see
  `positionBox` / `layoutBox` in `src/vm-bridge.js`, and spec §4.
  `getBoundingClientRect()` is no use mid-play because it reads the *transformed* box, and
  "re-measure at `animationend`" is no use either: six catalog 1.1.0 entries (pulse, heartbeat,
  glow, spin, float, shimmer) default to `iteration: infinite` and never end. So while one of our
  animations is running the box is `offsetLeft`/`offsetTop`/`offsetWidth`/`offsetHeight`
  accumulated up the `offsetParent` chain — layout values no `transform` can reach — corrected by
  the difference between that and `getBoundingClientRect()` taken the last time the element was
  measured at rest. The correction cancels every reason the two disagree that is not our
  animation, provided it does not change during the play. Measured in Chromium against a page
  scroll, a nested scroller, a `position: fixed` ancestor, a fixed element, a `position: sticky`
  ancestor, a sticky element, a transformed ancestor, an absolutely positioned element in both a
  static and a relative scroller, a sub-pixel box and a wrapped inline: all exact. What it does
  *not* survive, in rough order of likelihood:
  - an **ancestor's own transform changing** during our animation (a host carousel sliding the
    container, a parent of ours also animating) — the correction was measured against the old one,
    so the ring is off by the change until the element is next measured at rest;
  - an element whose **wrapping changes** during our animation: `offsetWidth` is the first
    fragment of a wrapped inline, `getBoundingClientRect()` is the union of all of them;
  - **keyframes that animate layout** rather than transform (`width`, `margin`, `top`): there is
    no resting box distinct from the live one, and the ring marks the live one. Nothing in the
    catalog does this.
  - an element selected **while it is already mid-animation**: there is no at-rest measurement to
    correct with, so the uncorrected layout box is used. Right to within `offsetWidth`'s rounding
    unless an ancestor is transformed.
  `layoutBox` reads one resolved `position` value per call to tell an absolutely positioned
  element (which does not move with a scroller between it and its containing block) from
  everything else. That is the only `getComputedStyle` on the overlay path.
