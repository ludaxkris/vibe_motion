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
| `src/protocol.ts` | Message types, `AppliedAssignment`, `ElementInfo`, the validation regexes, `IN_VIEW_THRESHOLD`, `BULK_APPLY_LIMIT`. |
| `test/harness.ts` | `loadBridge(html)` — builds a JSDOM, stubs `window.parent`, evaluates the script and hands back a controllable frame (fake `IntersectionObserver`, fake `requestAnimationFrame`, recorded posts). |
| `e2e/harness.ts` | `mountBridge(page, body)` — the same script in a real browser: the test page is the shell on one origin, the framed page is the clone on another, and a third origin hosts a frame that tries to talk to the bridge. Everything is fulfilled by `page.route`, so there is no app and no API to start. |

`vm-bridge.js` is a **plain classic script**, not a module. It is loaded into someone else's page
under a CSP of `script-src 'self'; connect-src 'none'`: no `eval`, no injected inline script, no
network call. It cannot `import` `protocol.ts`, so it duplicates the three validation regexes and
`typecheck` (tsc with `checkJs`) checks it against the JSDoc types; `test/render.test.ts` asserts
the two copies of the regexes are byte-identical.

The bridge is a **dumb renderer** (spec D1): the shell computes every byte of CSS and sends it in
an `AppliedAssignment`. The bridge never reads the catalog and never builds a keyframes name.

Everything it injects into the page is prefixed:

| Injected | What |
|---|---|
| `<style id="vm-runtime">` | every `@keyframes` body in use (reference-counted), one `[data-vm-id="…"] { … }` base-styles rule per assignment, and the crosshair rule. Always the bridge's own element, mutated through CSSOM (`insertRule` / `rule.style.cssText`), never by writing text |
| `data-vm-mode="edit"` on `<html>` | what the crosshair rule keys on; Phase 6's reserved `mode` message is one attribute flip |
| `<div data-vm-overlay>` | the fixed, `pointer-events: none` container holding the hover outline and the selection ring |
| `data-vm-overlay-hover` / `data-vm-overlay-ring` / `data-vm-overlay-label` | the three boxes inside it, so a test or a screenshot can name what it means instead of counting children |
| `data-vm-hovered` / `data-vm-selected` on that container | the vmId the outline and the ring are currently drawn around; the bridge's only readable state, which is how the tests and the Phase 4 e2e spec assert that a click did **not** move the ring (spec D10) |
| `--vm-*` custom properties, `animation-*` longhands | inline on the element, the animation group `!important` and only while the trigger is armed. The group is always *whole*: any longhand the payload omits is written at its initial value, so the host's cannot leak in |

The one thing that is **not** `vm-` prefixed is the `postMessage` type names (`apply`, not
`vm-apply`): the envelope's `source: "vibe-motion"` namespaces them, per spec D9 and the amended
naming rule in CLAUDE.md.

## How it is consumed

Nothing imports this package yet — PR A is the package on its own.

- **`apps/api`** (Phase 4 PR C): a Gradle `bridgeResources` Sync task copies `src/vm-bridge.js`
  into the jar the way `catalogResources` copies the catalog, and `BridgeAssets.kt` parses
  `BRIDGE_VERSION` out of the script instead of hand-syncing a Kotlin constant. Ktor serves it at
  `/bridge/vm-bridge.js` and `BridgePageRenderer` injects
  `<script src="/bridge/vm-bridge.js" data-vm-parent-origin="<WEB_ORIGIN>" defer>`.
- **`apps/web`** (Phase 4 PRs B and C): imports the types and constants as TypeScript source —
  `import type { AppliedAssignment } from "bridge"` — and its mock page route serves the very same
  `src/vm-bridge.js` file, so mock-mode e2e exercises the script the API ships.

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
| a message from a third origin is never acked | needs three real origins |
| `baseStyles` and `keyframesCss` cannot escape their rules | needs a real CSS parser |

Still unproven anywhere, and worth knowing:

- `ElementInfo.rect` / `pageRect` / `visible` are exercised but never meaningfully asserted
  (`visible` is always `false` under jsdom).
- Where the overlay boxes actually land: which element they are drawn around is asserted through
  `data-vm-hovered` / `data-vm-selected` and the ring's rect is checked in `e2e/`, but the 6px
  offset and the label position are not.
- Only Chromium is in the gate. The review measured the same behaviour in WebKit and Firefox by
  hand; nothing re-checks them per commit.

## Known limits

- **Duplicate `data-vm-id` in a clone.** The element map keeps the first element with a given
  vmId, so inline styles land only on that one, but the `[data-vm-id="…"] { … }` base-styles rule
  matches every copy, and `clear` restores only the first. The clone pipeline is what should
  guarantee uniqueness; the bridge does not police it.
