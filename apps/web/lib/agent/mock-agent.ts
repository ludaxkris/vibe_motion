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

function pool(category: CatalogEntry["category"]): CatalogEntry[] {
  const catalog = getCatalog(CURRENT_VERSION);
  if (!catalog) throw new Error(`catalog ${CURRENT_VERSION} is missing`);
  return filterPool(catalog.entries, category);
}

/**
 * The v0 agent: a seeded random pick with light heuristics. It always resolves
 * against `CURRENT_VERSION` and ignores `existing`, `prompt`, `catalogVersion`
 * and `signal`; they are in the context so the server-side agent (DT-003)
 * needs no interface change.
 */
export class MockAnimationAgent implements AnimationAgent {
  private readonly rng: Rng;

  constructor(seed: number) {
    this.rng = createRng(seed);
  }

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
      const assignment = this.suggest(el, ctx.viewport, loadIndex);
      if (assignment.trigger === "load") loadIndex += 1;
      assignments[el.vmId] = assignment;
    }
    return { assignments, skipped };
  }
}
