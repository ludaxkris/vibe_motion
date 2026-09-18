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

`vm-bridge.js` is a **plain classic script**, not a module. It is loaded into someone else's page
under a CSP of `script-src 'self'; connect-src 'none'`: no `eval`, no injected inline script, no
network call. It cannot `import` `protocol.ts`, so it duplicates the three validation regexes and
`typecheck` (tsc with `checkJs`) checks it against the JSDoc types; `test/render.test.ts` asserts
the two copies of the regexes are byte-identical.

The bridge is a **dumb renderer** (spec D1): the shell computes every byte of CSS and sends it in
an `AppliedAssignment`. The bridge never reads the catalog and never builds a keyframes name.
Everything it injects into the page is prefixed: `<style id="vm-runtime">`, `<div data-vm-overlay>`,
`--vm-*` custom properties, `vm-*` keyframes names.

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
pnpm gates:bridge                # both of the above, the way CI runs them
node --check packages/bridge/src/vm-bridge.js   # it still parses as a classic script
```

## Things the tests cannot prove

jsdom has no layout, no real animations and no `IntersectionObserver`, so these are covered by
construction and by the Phase 4 e2e specs rather than by unit tests:

- `getBoundingClientRect()` returns zeros, so `ElementInfo.rect` / `pageRect` values and
  `ElementInfo.visible` are exercised but never meaningfully asserted.
- Overlay geometry (where the hover outline and the selection ring actually land).
- That a restart (`animation-name: none` -> forced style flush -> name back) really replays the
  animation, and that `animationend` fires after a `replay` on a `hover` / `in-view` element.
- jsdom's CSSOM does not expand the `animation` shorthand into longhands, so a host page's
  `style="animation: spin 2s"` is left alone here but is genuinely snapshotted longhand by
  longhand in a browser.
