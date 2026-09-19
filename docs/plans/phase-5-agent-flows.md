# Phase 5 — Mock agent and Control Panel flows: design and implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking. Read `CLAUDE.md` first; it is binding.

**Goal:** "✦ Auto-generate for this element", "Choose custom animation" → pick → tune, and "✦ Auto-generate for this page" all work against a cloned page, fill the client-side draft only, and end in a result list the designer can tune from.

**Architecture:** A pure, async `AnimationAgent` in `apps/web/lib/agent` turns `ElementInfo` records into `Assignment`s; `MockAnimationAgent` is a seeded random pick with light heuristics. The page's elements come from the bridge through the `elements:query` / `elements:list` pair that protocol v1 reserved for this phase. The panel machine gains one state, `auto`, for the handoff's result list (mock `2k`). The store remembers what the agent produced so a re-roll never touches hand-tuned work. Nothing in this phase calls the API.

**Tech stack:** TypeScript strict, Zustand 5, vitest + React Testing Library, plain-JS bridge script (`// @ts-check`), Playwright.

**Spec:** this document, §1–§3 (there is no separate spec file). It refines `docs/build_plan.md` "Phase 5", `docs/user_flow.md`, `docs/design/README.md` (result view `2k`) and `docs/plans/phase-4-bridge-protocol.md` §3 (reserved messages). Decisions marked **(owner)** were made by Chris on 2026-09-18.

## 1. Decisions

| # | Decision | Why |
|---|---|---|
| D1 | **(owner) Two tracks.** Track A (Tasks 1–3) starts now in three worktrees and touches nothing Phase 4 has in flight. Track B (Tasks 4–7) starts when `feat/4-bridge-integration` is on `main`, behind a seam check (Task 0). | Phase 4 Tasks 6–10 rewrite `apps/web/lib/store/index.ts` and `editor-shell.tsx`. Track A is the half of Phase 5 that does not need them. |
| D2 | **(owner) Auto-generate keeps the user's work and re-rolls the agent's.** An element is *agent-owned* iff `assignmentsEqual(draftState[vmId], generated[vmId])`, where `generated` is a client-only map of each assignment exactly as the agent produced it. Any hand edit (param, trigger, re-pick) breaks the equality, so ownership lapses with no bookkeeping on edit paths. Auto-generate and Regenerate assign only to elements with no draft assignment or an agent-owned one; everything else goes to the agent as context. "Remove all" removes agent-owned assignments only. | One click must never discard hand tuning. Deriving ownership from equality means Phase 4's store actions need no changes. |
| D3 | **(owner) Result view is mock `2k` without the on-page badges.** New panel state `auto`; rows are one per element (no `.plan ×3` grouping: `ElementInfo` carries no class list). Badges and grouping are logged as deferred tasks. | Badges need a second bridge message and overlay work in a file Phase 4 may still be fixing. |
| D4 | **Element discovery = the reserved `elements:query` → `elements:list`**, implemented as specified plus one additive field, `viewport: { width, height }`, on `elements:list` so the agent can tell above-the-fold from below. | `ElementInfo` already has tag, role, text, rects, order, visibility. The API cannot supply layout; hover events only cover what the pointer crossed. |
| D5 | **The agent interface is async and returns vmId-keyed results.** `suggestForElement(ctx): Promise<Assignment>`, `suggestForPage(ctx): Promise<PageSuggestion>`. | The DT-003 swap to a server-side LLM then changes no call site. build_plan's `Assignment[]` loses the element mapping. |
| D6 | **Heuristics.** Targets: visible, ≥ 40×40 px, tag in `h1–h6, p, li, blockquote, img, picture, video, figure, article, button, a` or `role="button"`; nested targets are all kept (hover on a link inside an animated card is fine). `button`, `a`, `[role=button]` → category `hover`; everything else → category `entrance`. Never `exit`. `underline-sweep` is on `EXCLUDED_ANIMATION_IDS` until DT-116 is fixed. Trigger: hover picks use `hover`; entrance picks use `load` when `pageRect.y < viewport.height`, else `in-view`. Stagger: the n-th `load` entrance in document order gets `delay = min(n × 60, 600) ms`; `in-view` and hover get the catalog default. All other params are catalog defaults. | build_plan Phase 5 (60 ms wins over the mock's 120 ms: docs win on behaviour). Values stay inside catalog min/max because the API validates them on Save (422 `invalid_diff`). |
| D7 | **Determinism.** `MockAnimationAgent` takes a numeric seed; unit tests pin seeds. The app seeds from `Date.now()`; Regenerate uses `lastRun.seed + 1`. e2e asserts seed-independent invariants (categories, triggers, stagger, no exit), not exact picks. | No test-only seed channel into a production build. |
| D8 | **Prompt.** The idle textarea becomes controlled (`prompt` in the store), is passed in the agent context, quoted in the result view, and ignored by the mock. A tooltip on the textarea says: "The v0 agent picks at random and ignores this text." | build_plan "Prompt input". |
| D9 | **Vocabulary.** UI copy stays as shipped ("✦ Auto-generate for this element / page"). Code and docs call the per-element action *generate* and the page action *auto-generate*. | The handoff wins on visuals. |
| D10 | **Failure handling.** `queryElements` rejects after 3 s or on a new `ready`; zero targets is not an error. Both leave the draft untouched and show one inline message under the button ("Couldn't read the page. Try again." / "Nothing on this page looks worth animating."). | No partial application. |

## 2. Data flow

```
idle: [prompt] + "✦ Auto-generate for this page"
  → bridge.queryElements({ limit: 200 })            elements:query → elements:list
  → split elements by D2 into candidates / context
  → agent.suggestForPage({ elements: candidates, existing, prompt, viewport })
  → store.applyPageSuggestion(...)                  ONE set(): draftState, generated, lastRun, panel → auto
  → Phase 4 subscriber sees > BULK_APPLY_LIMIT changes → one state:load; ≤ 8 → apply/clear
selected: "✦ Auto-generate for this element"
  → agent.suggestForElement({ element: elements[vmId], existing, prompt, viewport })
  → store.applyGenerated(vmId, assignment)          draft + generated, panel → tuning
```

## 3. Protocol addition (shared contract, additive)

```ts
// ToBridge
| { type: "elements:query"; payload: { filter?: { tags?: string[]; minWidth?: number; minHeight?: number }; limit?: number } }
// ToShell
| { type: "elements:list"; payload: { seq: number; elements: ElementInfo[]; truncated: boolean; viewport: { width: number; height: number } } }
```

- `elements:query` must carry an envelope `seq`; without one the bridge acks nothing and posts nothing (there is no way to correlate the answer). With one it posts `elements:list` (payload `seq` = envelope `seq`) and then the normal `ack`.
- Elements are listed in document order. `filter.tags` are lower-case tag names; an element with `role="button"` matches a filter that contains `"button"`. `minWidth` / `minHeight` compare against the border box. Invisible elements (`visible === false`) are never listed. `limit` defaults to `ELEMENTS_QUERY_LIMIT = 200` and is clamped to `[1, 500]`; `truncated` is true when more matched.
- Malformed payload (non-object `filter`, non-array `tags`, non-number sizes or limit) → `ack { ok: false, error: "invalid-payload" }`, no list.
- One layout pass: every `getBoundingClientRect` happens in one loop with no style writes in between.
- `BRIDGE_VERSION` → `1.1.0`. `PROTOCOL_VERSION` stays `1` (additive).

## Global constraints

- No task adds an API call. `generated`, `lastRun` and `prompt` are client-only and never enter a diff (CLAUDE.md rule 9).
- Every `Assignment` the agent emits has `catalogVersion = CURRENT_VERSION`, a `trigger` that is in `entry.triggers`, and a `params` map with **every** param key of the entry, values in the catalog's unit and inside min/max.
- `apps/web/lib/agent` imports only `animation-catalog`, `resolveParams` from `@/lib/runtime-css`, and types from `bridge` / `@/lib/api-client`. No React, no store, no `window`.
- Bridge rules from Phase 4 still hold: explicit target origin, prefixed injected names, unknown types ignored.
- `apps/api/openapi.yaml` and `schema.json` are not changed by this phase.
- TDD, conventional commits, no screenshots on working branches, `pnpm gates` in the background before ready-for-review.

## Sequencing and PR slicing

| PR | Branch | Tasks | Can start | Touches Phase 4's in-flight files? |
|---|---|---|---|---|
| A1 | `feat/5-mock-agent` | 1 | now | no (new directory) |
| A2 | `feat/5-bridge-elements-query` | 2 | now | `packages/bridge/src/*` is on `main`; Phase 4 may patch the script. Additive handler; post a memory.md Notice first |
| A3 | `feat/5-panel-auto-state` | 3 | now | `panel-machine.ts` (not in Phase 4's plan) + two one-line selector fixes in `store/index.ts`; say so in the Notice |
| B | `feat/5-agent-integration` | 0, 4–7 | Phase 4 PR C and A1–A3 on `main` | edits Phase 4's finished store, client and shell |

---

### Task 1 (PR A1): `apps/web/lib/agent`

**Files**
- Create: `apps/web/lib/agent/types.ts`, `rng.ts`, `targets.ts`, `mock-agent.ts`, `index.ts` and `rng.test.ts`, `targets.test.ts`, `mock-agent.test.ts`
- Modify: `apps/web/package.json` (add `"bridge": "workspace:*"` if Phase 4 has not already; keep both lines on conflict)

**Interfaces — produces**

```ts
// types.ts
import type { ElementInfo } from "bridge";
import type { Assignment } from "@/lib/api-client";

export type Viewport = { width: number; height: number };
export type ElementContext = { element: ElementInfo; existing: Record<string, Assignment>; prompt: string; viewport: Viewport };
export type PageContext = { elements: ElementInfo[]; existing: Record<string, Assignment>; prompt: string; viewport: Viewport };
export type SkipReason = "not-semantic" | "too-small" | "hidden";
export type PageSuggestion = { assignments: Record<string, Assignment>; skipped: { vmId: string; reason: SkipReason }[] };
export interface AnimationAgent {
  suggestForElement(ctx: ElementContext): Promise<Assignment>;
  suggestForPage(ctx: PageContext): Promise<PageSuggestion>;
}

// index.ts
export { MockAnimationAgent } from "./mock-agent";
export { selectTargets, TARGET_TAGS, MIN_TARGET_SIZE } from "./targets";
export const STAGGER_MS = 60;
export const STAGGER_CAP_MS = 600;
export const EXCLUDED_ANIMATION_IDS: readonly string[] = ["underline-sweep"]; // DT-116
```

- [ ] **Step 1: failing tests for `rng.ts`**

```ts
import { createRng } from "./rng";
it("is deterministic per seed and stays in [0, 1)", () => {
  const a = createRng(42), b = createRng(42), c = createRng(43);
  const seqA = [a(), a(), a()], seqB = [b(), b(), b()];
  expect(seqA).toEqual(seqB);
  expect(seqA).not.toEqual([c(), c(), c()]);
  for (const n of seqA) { expect(n).toBeGreaterThanOrEqual(0); expect(n).toBeLessThan(1); }
});
```

- [ ] **Step 2: implement `rng.ts`** (mulberry32)

```ts
export type Rng = () => number;
export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function pick<T>(rng: Rng, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error("pick() from an empty list");
  return item;
}
```

- [ ] **Step 3: failing tests for `targets.ts`.** Build `ElementInfo` with a local `el(overrides)` helper (defaults: `tag: "p"`, `role: null`, `visible: true`, 200×50 rects, `order: 0`). Cases: `h2`, `img`, `a`, `article` are targets; `div` → skipped `not-semantic`; `div` with `role: "button"` is a target; 39×200 `h1` → `too-small`; `visible: false` → `hidden` (checked first); output `targets` is sorted by `order` even when input is not.

- [ ] **Step 4: implement `targets.ts`**

```ts
import type { ElementInfo } from "bridge";
import type { SkipReason } from "./types";

export const MIN_TARGET_SIZE = 40;
export const TARGET_TAGS: readonly string[] = [
  "h1", "h2", "h3", "h4", "h5", "h6", "p", "li", "blockquote",
  "img", "picture", "video", "figure", "article", "button", "a",
];
const HOVER_TAGS: readonly string[] = ["button", "a"];

export function isHoverTarget(el: ElementInfo): boolean {
  return HOVER_TAGS.includes(el.tag) || el.role === "button";
}
export function skipReason(el: ElementInfo): SkipReason | null {
  if (!el.visible) return "hidden";
  if (!TARGET_TAGS.includes(el.tag) && el.role !== "button") return "not-semantic";
  if (el.pageRect.width < MIN_TARGET_SIZE || el.pageRect.height < MIN_TARGET_SIZE) return "too-small";
  return null;
}
export function selectTargets(elements: readonly ElementInfo[]) {
  const targets: ElementInfo[] = [];
  const skipped: { vmId: string; reason: SkipReason }[] = [];
  for (const el of [...elements].sort((a, b) => a.order - b.order)) {
    const reason = skipReason(el);
    if (reason) skipped.push({ vmId: el.vmId, reason });
    else targets.push(el);
  }
  return { targets, skipped };
}
```

- [ ] **Step 5: failing tests for `mock-agent.ts`** (`viewport = { width: 1280, height: 800 }`):
  - same seed + same context → deep-equal `PageSuggestion`; seeds 1..20 produce at least two distinct results.
  - over seeds 1..50, for a page of `h1` (y 100), `img` (y 300), `a` (y 400), `p` (y 1500), `div`: every `h1`/`img`/`p` pick has category `entrance`; every `a` pick has category `hover` and `trigger: "hover"`; no pick has category `exit`; no pick is in `EXCLUDED_ANIMATION_IDS`; `div` is in `skipped`; (look categories up with `getEntry(CURRENT_VERSION, id)`).
  - triggers: `h1` and `img` → `load`; `p` at y 1500 → `in-view`.
  - stagger: `load` entrances in order get `delay` `"0ms"`, `"60ms"`, …; with 15 above-the-fold headings the last is `"600ms"`; the `in-view` element has the catalog default delay.
  - contract: for every assignment, `catalogVersion === CURRENT_VERSION`, `entry.triggers` includes `trigger`, and `Object.keys(params).sort()` equals `entry.params.map(p => p.key).sort()`.
  - `suggestForElement` on an `a` → hover category; on an `h2` below the fold → `in-view`, default delay; on a `div` (not a target) → still returns an entrance (the user asked for this element explicitly).
  - `existing` and `prompt` do not change the output (the mock ignores them): same seed with and without them is deep-equal.

- [ ] **Step 6: implement `mock-agent.ts`**

```ts
import { CURRENT_VERSION, getCatalog, type CatalogEntry } from "animation-catalog";
import type { ElementInfo } from "bridge";
import type { Assignment } from "@/lib/api-client";
import { resolveParams } from "@/lib/runtime-css";
import { createRng, pick, type Rng } from "./rng";
import { isHoverTarget, selectTargets } from "./targets";
import type { AnimationAgent, ElementContext, PageContext, PageSuggestion, Viewport } from "./types";

const STAGGER_MS = 60, STAGGER_CAP_MS = 600;
const EXCLUDED = new Set(["underline-sweep"]);

function pool(category: CatalogEntry["category"]): CatalogEntry[] {
  const catalog = getCatalog(CURRENT_VERSION);
  if (!catalog) throw new Error(`catalog ${CURRENT_VERSION} is missing`);
  return catalog.entries.filter((e) => e.category === category && !EXCLUDED.has(e.id));
}

export class MockAnimationAgent implements AnimationAgent {
  private readonly rng: Rng;
  constructor(seed: number) { this.rng = createRng(seed); }

  private suggest(el: ElementInfo, viewport: Viewport, loadIndex: number): Assignment {
    const hover = isHoverTarget(el);
    const entry = pick(this.rng, pool(hover ? "hover" : "entrance"));
    const params = resolveParams(entry); // every key, catalog defaults
    let trigger: Assignment["trigger"] = "hover";
    if (!hover) {
      trigger = el.pageRect.y < viewport.height ? "load" : "in-view";
      if (trigger === "load" && "delay" in params) {
        params.delay = `${Math.min(loadIndex * STAGGER_MS, STAGGER_CAP_MS)}ms`;
      }
    }
    return { animationId: entry.id, catalogVersion: CURRENT_VERSION, trigger, params };
  }

  async suggestForElement(ctx: ElementContext): Promise<Assignment> {
    return this.suggest(ctx.element, ctx.viewport, 0);
  }

  async suggestForPage(ctx: PageContext): Promise<PageSuggestion> {
    const { targets, skipped } = selectTargets(ctx.elements);
    const assignments: Record<string, Assignment> = {};
    let loadIndex = 0;
    for (const el of targets) {
      const a = this.suggest(el, ctx.viewport, loadIndex);
      if (a.trigger === "load") loadIndex += 1;
      assignments[el.vmId] = a;
    }
    return { assignments, skipped };
  }
}
```

  `resolveParams(entry, params?)` is `apps/web/lib/runtime-css/index.ts:53` and takes the package's `CatalogEntry` type, which is what `getCatalog()` returns, so no cast is needed. Import the constants from `index.ts` rather than redeclaring them if that creates no import cycle; otherwise move them to `constants.ts`.

- [ ] **Step 7:** `pnpm --filter web test lib/agent && pnpm --filter web typecheck && pnpm --filter web lint` all pass. Commit `feat(web): AnimationAgent interface and seeded MockAnimationAgent`.

### Task 2 (PR A2): bridge `elements:query` → `elements:list`

**Files**
- Modify: `packages/bridge/src/protocol.ts`, `packages/bridge/src/vm-bridge.js`, `packages/bridge/test/harness.ts` (only if a helper is needed), `packages/bridge/e2e/bridge.spec.ts`, `packages/bridge/README.md`, `docs/plans/phase-4-bridge-protocol.md` (§3: drop "*(reserved, Phase 5)*", add `viewport`, add the rules from §3 above; §7: remove `elements:query` from the out-of-scope list)
- Create: `packages/bridge/test/elements-query.test.ts`
- Shared files on `main`: `memory.md` Notice **before** the PR opens.

**Interfaces — produces:** the two union members in §3, plus `export const ELEMENTS_QUERY_LIMIT = 200 as const; export const ELEMENTS_QUERY_MAX = 500 as const;` in `protocol.ts`.

- [ ] **Step 1: failing vitest (jsdom) tests.** jsdom has no layout, so stub `getBoundingClientRect` per element before sending. Cases: query with `seq: 7` posts one `elements:list` with `payload.seq === 7`, then an `ack { seq: 7, ok: true }`, in that order; elements are in document order with ascending `order`; `filter.tags: ["h1","button"]` returns the `h1`, the `<button>` and a `<div role="button">`, not the `<p>`; `minWidth: 40, minHeight: 40` drops a 30×200 element; an element with a zero box is never listed; `limit: 2` on a page of 5 → 2 elements, `truncated: true`; `limit: 9999` clamps to 500; default limit is 200; `viewport` equals `{ width: window.innerWidth, height: window.innerHeight }`; `filter: "x"`, `filter: { tags: "h1" }`, `limit: "2"` → `ack ok:false, error:"invalid-payload"` and **no** list; a query with no `seq` posts nothing; `ready.bridgeVersion === "1.1.0"`; overlay nodes are never listed.
- [ ] **Step 2:** run `pnpm --filter bridge test`; expect the new file to fail (unknown type is ignored, so no `elements:list`).
- [ ] **Step 3: implement.** In `protocol.ts` add the union members and constants. In `vm-bridge.js`: bump `BRIDGE_VERSION`; `onMessage` passes the envelope `seq` to handlers as a second argument (`handler(data.payload, data.seq)`; existing handlers ignore it); add

```js
HANDLERS["elements:query"] = function (payload, seq) {
  if (typeof seq !== "number") return null;
  var p = payload || {};
  var f = p.filter === undefined ? {} : p.filter;
  if (!f || typeof f !== "object") return { ok: false, error: "invalid-payload" };
  if (f.tags !== undefined && !Array.isArray(f.tags)) return { ok: false, error: "invalid-payload" };
  if (f.minWidth !== undefined && typeof f.minWidth !== "number") return { ok: false, error: "invalid-payload" };
  if (f.minHeight !== undefined && typeof f.minHeight !== "number") return { ok: false, error: "invalid-payload" };
  if (p.limit !== undefined && typeof p.limit !== "number") return { ok: false, error: "invalid-payload" };
  var limit = Math.max(1, Math.min(ELEMENTS_QUERY_MAX, p.limit === undefined ? ELEMENTS_QUERY_LIMIT : Math.floor(p.limit)));
  var list = [], truncated = false;
  var ids = Array.from(elements.keys()).sort(function (a, b) { return (orders.get(a) || 0) - (orders.get(b) || 0); });
  for (var i = 0; i < ids.length; i++) {
    var info = elementInfo(ids[i]);
    if (!info || !info.visible) continue;
    if (f.tags && f.tags.indexOf(info.tag) === -1 && !(info.role === "button" && f.tags.indexOf("button") !== -1)) continue;
    if (f.minWidth !== undefined && info.rect.width < f.minWidth) continue;
    if (f.minHeight !== undefined && info.rect.height < f.minHeight) continue;
    if (list.length === limit) { truncated = true; break; }
    list.push(info);
  }
  post("elements:list", { seq: seq, elements: list, truncated: truncated,
    viewport: { width: window.innerWidth, height: window.innerHeight } });
  return null;
};
```

  Match the file's actual registration style for `HANDLERS` and its `elements` / `orders` map names (read `vm-bridge.js` around `elementInfo`, line ~899, first). The constants are duplicated as literals in the script (it has no imports); extend the existing "script literals equal `protocol.ts`" test to cover them.
- [ ] **Step 4:** `pnpm --filter bridge test typecheck` pass.
- [ ] **Step 5: bridge e2e** (real layout, in `packages/bridge/e2e/bridge.spec.ts`): on the static page, a query with `filter: { minWidth: 40, minHeight: 40 }` returns non-zero `pageRect`s in document order, `viewport` matches the Playwright viewport, and a `display:none` element is absent. Measure: `ack.ms < 50` for the fixture page (one layout pass). `pnpm --filter bridge e2e` passes.
- [ ] **Step 6:** commit `feat(bridge): elements:query / elements:list (protocol v1, additive)`.

### Task 3 (PR A3): panel machine `auto` state and the result view

**Files**
- Modify: `apps/web/lib/store/panel-machine.ts`, `panel-machine.test.ts`; `apps/web/components/control-panel/tuning.tsx`, `selected.tsx` (+ tests; optional `onBack`); `apps/web/lib/store/index.ts` **only** where `tsc` forces it (`selectSelectedVmId`, `selectGuardedVmId`: replace `panel.status === "idle" ? null : panel.vmId` with `"vmId" in panel ? panel.vmId : null`); `apps/web/components/control-panel/index.tsx` (render the `auto` case; until Task 5 it receives empty rows and is unreachable); `apps/web/app/dev/dev-gallery.tsx` (frame `panel-auto-result`); `apps/e2e/web/mocked/dev-gallery.spec.ts` (expect nine frames)
- Create: `apps/web/components/control-panel/auto-result.tsx`, `auto-result.test.tsx`

**Interfaces — produces**

```ts
// panel-machine.ts
export type PanelState =
  | { status: "idle" }
  | { status: "auto" }
  | { status: "selected"; vmId: string; returnTo?: "auto" }
  | { status: "choosing"; vmId: string; returnTo?: "auto" }
  | { status: "tuning"; vmId: string; animationId: string; returnTo?: "auto" };
export type PanelEvent = /* existing members */ | { type: "AUTO_DONE" } | { type: "AUTO_CLOSE" } | { type: "CHANGE" };

// auto-result.tsx
export type AutoResultRow = { vmId: string; tag: string; animationName: string; trigger: Trigger; duration: string; delay: string };
export type AutoResultProps = {
  rows: AutoResultRow[]; prompt: string; skippedCount: number; truncated: boolean;
  onSelectRow(vmId: string): void; onRegenerate(): void; onReplayAll(): void; onRemoveAll(): void; onClose(): void;
  replayDisabled?: boolean;
};
```

Transition rules (add to the doc comment, keep identity no-ops):
- `AUTO_DONE`: from **any** state → `{ status: "auto" }` (identity when already `auto`).
- `AUTO_CLOSE`: `auto` → `idle`; no-op elsewhere.
- `SELECT` from `auto`, or from a state that has `returnTo: "auto"`, carries `returnTo: "auto"` onto the new state. The same-element identity checks compare `returnTo` too.
- `CHOOSE_CUSTOM`, `PICK`, `CLEAR`, `REVERT` preserve `returnTo`.
- `CHANGE` (new): `tuning` → `choosing`, preserving `returnTo`; no-op elsewhere. Today the tuning panel's "Change" link dispatches `BACK` (`control-panel/index.tsx:111`) and tuning has no "‹" control; switch "Change" to `CHANGE` so `BACK` is free to mean "up one level".
- `BACK` from `tuning`/`selected` with `returnTo: "auto"` → `auto`. `BACK` from `tuning` without it is unchanged (→ `choosing`, kept for compatibility); `BACK` from `choosing` is unchanged and preserves `returnTo`. `tuning.tsx` and `selected.tsx` gain an optional `onBack` prop that renders the same "‹" control `choosing.tsx` has, passed only when `returnTo === "auto"`.
- `DESELECT` → `idle` from every state including `auto` (the idle panel's "Animated · n" rows still list everything).
- `REVERT` from `auto` → `idle` (the generated assignments are gone).

- [ ] **Step 1: failing machine tests**, one `it` per rule above, in the file's existing `from <state>` grouping, plus a `from auto` group: `SELECT` with and without `draftAnimationId`; `AUTO_CLOSE`; `DESELECT`; `REVERT`; `BACK`, `PICK`, `CHOOSE_CUSTOM`, `CLEAR`, `CHANGE` are identity no-ops from `auto`; `CHANGE` from `tuning` reaches `choosing` with and without `returnTo`; component tests: "Change" dispatches `CHANGE`, and "‹" appears in tuning only when `onBack` is passed. Example:

```ts
it("BACK from a tuning state opened from the result list returns to the list", () => {
  const s = transition({ status: "auto" }, { type: "SELECT", vmId: "vm-a", draftAnimationId: "fade-in" });
  expect(s).toEqual({ status: "tuning", vmId: "vm-a", animationId: "fade-in", returnTo: "auto" });
  expect(transition(s, { type: "BACK" })).toEqual({ status: "auto" });
});
```

- [ ] **Step 2:** fail, implement, pass; `pnpm --filter web typecheck` tells you which selectors need the `"vmId" in panel` fix.
- [ ] **Step 3: failing component tests** for `auto-result.tsx` (per `docs/design/README.md` line 38 and mock frame `2k` in `docs/design/mocks/Vibe Motion Hi-fi.dc.html`): heading "✦ Generated 3 animations" (singular "1 animation"); "Regenerate" calls `onRegenerate`; the prompt is quoted, and the quote block is absent when `prompt` is empty; one row per entry reading `h1 · Fade In Up · load · 600ms · 0ms`; clicking a row and pressing Enter on it call `onSelectRow(vmId)`; caption "Click a row to tune it, or click the element on the page." plus "Skipped 4 elements (too small, hidden or not content)." when `skippedCount > 0` and "Only the first 200 elements were considered." when `truncated`; "↻ Replay all" is disabled when `replayDisabled`; "Remove all" calls `onRemoveAll`; "‹" calls `onClose`.
- [ ] **Step 4:** implement with `PanelCard` / `PanelSection`, `Button` (`glyph="✦" glyphTone="accent"`, `glyph="↻" glyphTone="ink"`), tokens from `docs/design/design-system/`. No store import in this file. Add the `/dev` frame with three fixture rows; update the mocked e2e frame count.
- [ ] **Step 5:** `pnpm --filter web test typecheck lint` and `pnpm e2e` (background) pass. Run `screenshot-runner` for the new frame. Commit `feat(web): panel 'auto' state and auto-generate result view`.

---

### Task 0 (PR B, first): seam check

Track B is written against Phase 4's **plan**, not its code. Verify on `main`, and fix this plan's text in the same PR where an assumption fails:

- [ ] `apps/web/lib/store/index.ts` exports `createEditorStore()`, state `elements: Record<string, ElementInfo>`, actions `rememberElement`, `requestSelect`, `resolveGuard`, and the draft actions from Phase 3 unchanged.
- [ ] `apps/web/lib/bridge/client.ts` exports `createBridgeClient` / `BridgeClient`; find where it allocates `seq` and resolves acks (Task 4 reuses both), and what it does with pending promises on a new `ready`.
- [ ] The store subscriber sends one `state:load` when more than `BULK_APPLY_LIMIT` entries change in **one** `set()`.
- [ ] How Control Panel components reach the client today (Phase 4 Task 9 wired Replay and card-hover preview): hook, context or prop. Task 5 uses the same route; do not invent a second one.
- [ ] `apps/e2e/web/stack/` has a Phase 4 bridge spec; note its helper for "click element inside the preview iframe" and reuse it.
- [ ] Tasks 1–3 are on `main`; `ready.bridgeVersion` is `1.1.0` in the stack image.

### Task 4 (PR B): store provenance and `queryElements`

**Files:** modify `apps/web/lib/store/index.ts` (+ test), `apps/web/lib/bridge/client.ts` (+ test).

**Interfaces — produces**

```ts
// store state (all client-only; reset() clears them)
prompt: string;
generated: Record<string, Assignment>;
lastRun: { seed: number; prompt: string; skippedCount: number; truncated: boolean } | null;
// actions
setPrompt(prompt: string): void;
applyGenerated(vmId: string, assignment: Assignment): void;        // draft + generated; panel → tuning (keeps returnTo)
applyPageSuggestion(input: { suggestion: PageSuggestion; seed: number; prompt: string; truncated: boolean }): void;
removeAllGenerated(): void;                                        // agent-owned only; panel: auto stays auto
// selectors
selectAgentOwnedVmIds(state): string[];     // draft[vmId] && generated[vmId] && assignmentsEqual(both)
selectAutoCandidates(state, elements: ElementInfo[]): { candidates: ElementInfo[]; existing: Record<string, Assignment> };
// client
queryElements(query?: { filter?: {...}; limit?: number }): Promise<{ elements: ElementInfo[]; truncated: boolean; viewport: Viewport }>;
```

- [ ] **Step 1: failing store tests.** `applyPageSuggestion` writes draft, `generated`, `lastRun` and `panel: { status: "auto" }` in one `set` (subscribe and assert exactly one notification); an assignment for a vmId that is user-owned (in draft, not equal to `generated`) is **not** overwritten even if the suggestion contains it; `selectAutoCandidates` excludes user-owned elements from `candidates` and lists their assignments in `existing`, and includes agent-owned and unassigned ones; after `updateDraftParam` on a generated element it is no longer in `selectAgentOwnedVmIds`; setting the param back to the generated value makes it agent-owned again (documented consequence of D2); `removeAllGenerated` leaves a hand-tuned element in the draft and empties `generated`; `revertDraft` clears `generated` and `lastRun`; `applyGenerated` lands the panel in `tuning` with the suggestion's `animationId`; none of these touch `currentVersionState`; `useUnsaved` is true after each.
- [ ] **Step 2: failing client tests.** `queryElements()` posts `elements:query` with a fresh `seq` to `expectedOrigin`; resolves with the payload of the `elements:list` whose `payload.seq` matches, ignoring other seqs; rejects with `Error("elements-query-timeout")` after 3000 ms (fake timers); rejects on `ack ok:false`; rejects when a new `ready` arrives; rejects immediately when status is not `ready`; each returned element is also `rememberElement`-ed so rows can show tags.
- [ ] **Step 3–4:** implement, pass `pnpm --filter web test typecheck lint`. **Step 5:** commit `feat(web): agent provenance in the draft store; bridge queryElements`.

### Task 5 (PR B): wire the three flows

**Files:** modify `apps/web/components/control-panel/idle.tsx`, `selected.tsx`, `index.tsx` (+ their tests), and the shell file that owns the bridge client (per Task 0); create `apps/web/lib/agent/run.ts` (+ test).

**Interfaces — produces**

```ts
// lib/agent/run.ts — the only place that joins store, client and agent
export type AgentDeps = { store: EditorStoreApi; bridge: Pick<BridgeClient, "queryElements">; createAgent?: (seed: number) => AnimationAgent; now?: () => number };
export type RunOutcome = { ok: true; count: number } | { ok: false; reason: "query-failed" | "no-targets" };
export function generateForElement(deps: AgentDeps, vmId: string): Promise<RunOutcome>;
export function autoGeneratePage(deps: AgentDeps, opts?: { regenerate?: boolean }): Promise<RunOutcome>;
```

`autoGeneratePage`: `seed = regenerate && lastRun ? lastRun.seed + 1 : now()`; `queryElements({ limit: 200 })`; `selectAutoCandidates`; `suggestForPage`; zero assignments → `no-targets` and nothing is written; else `applyPageSuggestion`. `generateForElement`: uses `store.elements[vmId]` (always present: selection stores it), viewport from the last `queryElements` result if any, else `{ width: element.rect.width + element.rect.x, height: Number.MAX_SAFE_INTEGER }` so an unknown fold means `load`; then `applyGenerated`.

- [ ] **Step 1: failing tests for `run.ts`** with a real store, a stub bridge and `createAgent: () => new MockAnimationAgent(1)`: page run lands on `auto` with `lastRun.seed` set; a rejecting bridge → `query-failed`, draft deep-equal to before; all-`div` page → `no-targets`; regenerate uses `seed + 1` and leaves a hand-tuned element's assignment identical (`toBe`); element run lands on `tuning`.
- [ ] **Step 2: failing component tests.** `idle`: textarea is controlled by `prompt`; has the D8 tooltip; the button is enabled when the bridge is `ready`, shows a busy state while the promise is pending (double click runs once), renders the D10 messages on failure; the old "arrives with the mock agent" caption is gone (replace the assertion in `idle.test.tsx`). `selected`: button enabled, runs `generateForElement`, replaces the disabled assertion in `selected.test.tsx`. `index.tsx`: in `auto`, rows are built from agent-owned vmIds in `elements[...].order` order using `getCatalogEntryAt(assignment.catalogVersion, id)` for the name; row click → `requestSelect(vmId)` (goes through Phase 4's guard); Regenerate → `autoGeneratePage({ regenerate: true })`; Remove all → `removeAllGenerated()`; Replay all → `client.replay(null)`; "‹" → `AUTO_CLOSE`.
- [ ] **Step 3–4:** implement; pass `pnpm --filter web test typecheck lint build`. **Step 5:** commit `feat(web): generate, auto-generate and the result list wired to the mock agent`.

### Task 6 (PR B): full-stack e2e

**Files:** create `apps/e2e/web/stack/agent-flows.spec.ts`; extend `apps/e2e/fixtures/marketing.html` only if a needed tag is missing (today: 1 `h1`, 3 `h2`, 4 `p`, 3 `article`, 1 `img`, 1 `a`, 1 `li`; enough, and > 8 targets so the `state:load` path is exercised). Add one below-the-fold `h2` (a tall spacer section) if none sits past 800 px.

Every test creates its own project, records requests with `page.on("request")`, and ends by asserting **no** request matched `POST **/projects/*/versions` and that the unsaved indicator is visible.

- [ ] **Generate:** click the `h1` in the iframe → "✦ Auto-generate for this element" → panel shows tuning; inside the frame the `h1` has an inline `animation-name` matching `/^vm-.+-v\d+-\d+-\d+$/`.
- [ ] **Custom → pick → tune:** click the `img` → "Choose custom animation" → pick "Fade In Up" → set duration to 900 ms → the element's inline `animation-duration` is `900ms`.
- [ ] **Auto-generate:** type a prompt → "✦ Auto-generate for this page" → heading matches `/Generated \d+ animations/` and the prompt is quoted; row count equals the number of elements with a `vm-` animation name in the frame; the `a` row says `hover`; no row names an exit animation (ids read from `packages/animation-catalog`); `load` rows' delays are `0ms, 60ms, 120ms…` in order; the below-the-fold heading row says `in-view`.
- [ ] **Keep user's work:** after Auto-generate, open the `h1` row, change duration, "‹" back to the list, Regenerate → the `h1`'s inline `animation-duration` is unchanged and its row is gone from the agent-owned list; "Remove all" leaves the `h1` animated and clears the rest.
- [ ] Run `pnpm e2e:docker` in the background; pass. Commit `test(e2e): generate, custom and auto-generate flows on the full stack`.

### Task 7 (PR B): docs, deferred log, screenshots, gates

- [ ] `docs/build_plan.md` Phase 5: async vmId-keyed interface (D5), ownership rule (D2), result view scope (D3). `docs/user_flow.md`: page Auto-generate lands on the result list, not "tuning". `docs/architecture.md`: `lib/agent` exists; Generate sequence shows `elements:query`. `CLAUDE.md` needs no change.
- [ ] `docs/deferred_tasks.md` on `main` (pull first, ids = max + 1): on-page badges for generated elements (P3, later, needs an additive bridge message); group sibling rows as `.plan ×3` (P3, later, needs an additive `ElementInfo` field); drop `underline-sweep` from `EXCLUDED_ANIMATION_IDS` when DT-116 closes (P2, this-phase, link DT-116); cap/stagger tuning and heuristics are constants pending real-agent work (fold into DT-003 notes); update DT-094 (keyboard nav exists; live preview half remains).
- [ ] `screenshot-runner`: idle with prompt, result list, tuning opened from the list. `pnpm gates` (background) → `code-reviewer` → fixes → `test-runner` on the final commit → ready → after merge `scripts/cleanup-merged.sh` + memory.md.

## Self-review

- Coverage: D1 → sequencing table, Task 0; D2 → Tasks 4, 5, 6 ("Keep user's work"); D3 → Tasks 3, 7; D4 → Task 2, Task 4 client; D5–D7 → Task 1, Task 5 seeds; D8 → Tasks 4, 5; D9 → copy in Tasks 3, 5; D10 → Tasks 4 (timeout), 5 (messages). build_plan exit criteria → Task 6 (three flows, no version, unsaved indicator).
- Names are consistent across tasks: `PageSuggestion`, `selectTargets`, `queryElements`, `applyPageSuggestion`, `applyGenerated`, `removeAllGenerated`, `selectAgentOwnedVmIds`, `selectAutoCandidates`, `AUTO_DONE` (dispatched inside `applyPageSuggestion`), `AUTO_CLOSE`, `CHANGE`, `returnTo`.
- Known softness, by design: Tasks 4–6 name Phase 4 files that do not exist on `main` yet. Task 0 re-verifies them; step-level code for those tasks is finalised at the seam check rather than guessed now, exactly as Phase 4's plan did for its Tasks 8–10.
- Open risk: if Phase 4 changes `panel-machine.ts` after all, PR A3 rebases; the machine change is ~40 lines and fully unit-tested, so the conflict is mechanical.
