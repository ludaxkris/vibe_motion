import { CURRENT_VERSION, getCatalog, type CatalogEntry } from "animation-catalog";
import type { ElementInfo } from "bridge";

import type { Assignment } from "@/lib/api-client";
import { resolveParams } from "@/lib/runtime-css";

import { EXCLUDED_ANIMATION_IDS, STAGGER_CAP_MS, STAGGER_MS } from "./constants";
import { createRng, pick, type Rng } from "./rng";
import { isHoverTarget, selectTargets } from "./targets";
import type { AnimationAgent, ElementContext, PageContext, PageSuggestion, Viewport } from "./types";

const EXCLUDED = new Set(EXCLUDED_ANIMATION_IDS);

/** The entries of `category` the agent may pick from. Exported for its test. */
export function filterPool(
  entries: readonly CatalogEntry[],
  category: CatalogEntry["category"],
): CatalogEntry[] {
  return entries.filter((e) => e.category === category && !EXCLUDED.has(e.id));
}

const pools = new Map<CatalogEntry["category"], CatalogEntry[]>();

/** Computed once per category: the catalog for `CURRENT_VERSION` never changes. */
function pool(category: CatalogEntry["category"]): CatalogEntry[] {
  let entries = pools.get(category);
  if (!entries) {
    const catalog = getCatalog(CURRENT_VERSION);
    if (!catalog) throw new Error(`catalog ${CURRENT_VERSION} is missing`);
    entries = filterPool(catalog.entries, category);
    pools.set(category, entries);
  }
  return entries;
}

/**
 * The v0 agent: a seeded random pick with light heuristics. It always resolves
 * against `CURRENT_VERSION` and ignores `existing`, `prompt`, `catalogVersion`
 * and `signal`; they are in the context so the server-side agent (DT-003)
 * needs no interface change. A page run does read `context` (blocks it may not
 * assign but must not animate inside of) and `viewport` (the `too-large` rule). Every call reseeds, so one instance gives the
 * same answer for the same context however often it is asked.
 */
export class MockAnimationAgent implements AnimationAgent {
  constructor(private readonly seed: number) {}

  /** `loadIndex` is the element's slot in the page stagger, or null to leave `delay` alone. */
  private suggest(rng: Rng, el: ElementInfo, viewport: Viewport, loadIndex: number | null): Assignment {
    const hover = isHoverTarget(el);
    const entry = pick(rng, pool(hover ? "hover" : "entrance"));
    const params = resolveParams(entry); // every key, catalog defaults
    let trigger: Assignment["trigger"] = "hover";
    if (!hover) {
      trigger = el.pageRect.y < viewport.height ? "load" : "in-view";
      if (trigger === "load" && loadIndex !== null && "delay" in params) {
        params.delay = `${Math.min(loadIndex * STAGGER_MS, STAGGER_CAP_MS)}ms`;
      }
    }
    return { animationId: entry.id, catalogVersion: CURRENT_VERSION, trigger, params };
  }

  async suggestForElement(ctx: ElementContext): Promise<Assignment> {
    return this.suggest(createRng(this.seed), ctx.element, ctx.viewport, null);
  }

  async suggestForPage(ctx: PageContext): Promise<PageSuggestion> {
    const { targets, skipped } = selectTargets(ctx.elements, {
      blocks: ctx.context,
      viewport: ctx.viewport,
    });
    const rng = createRng(this.seed);
    const assignments: Record<string, Assignment> = {};
    let loadIndex = 0;
    for (const el of targets) {
      const assignment = this.suggest(rng, el, ctx.viewport, loadIndex);
      if (assignment.trigger === "load") loadIndex += 1;
      assignments[el.vmId] = assignment;
    }
    return { assignments, skipped };
  }
}
