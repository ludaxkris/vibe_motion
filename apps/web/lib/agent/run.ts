/**
 * The one place that joins the draft store, the preview bridge and the agent
 * (Phase 5 plan, Task 5). Everything else in `lib/agent` stays pure — which is
 * why this file is imported by path and is NOT re-exported from `./index`.
 *
 * Both runs are all-or-nothing (plan D10): whatever goes wrong, the store is
 * exactly as it was, and the caller gets a reason to put under the button.
 * Nothing here calls the API — a run only ever fills the client-side draft
 * (CLAUDE.md rule 9).
 */
import { CURRENT_VERSION } from "animation-catalog";
import { ELEMENTS_QUERY_LIMIT, type ElementInfo } from "bridge";

import type { Assignment } from "@/lib/api-client";
import type { BridgeClient } from "@/lib/bridge";
import { selectAutoCandidates, type EditorStoreApi } from "@/lib/store";

import { MockAnimationAgent } from "./mock-agent";
import { MIN_TARGET_HEIGHT, MIN_TARGET_WIDTH, TARGET_TAGS } from "./targets";
import type { AnimationAgent, Viewport } from "./types";

export type AgentDeps = {
  store: EditorStoreApi;
  bridge: Pick<BridgeClient, "queryElements">;
  /** Defaults to the seeded mock; DT-003 swaps in the server-side agent here. */
  createAgent?: (seed: number) => AnimationAgent;
  /** The seed source. Defaults to `Date.now` (plan D7). */
  now?: () => number;
};

export type RunFailure = "query-failed" | "no-targets" | "agent-failed";
export type RunOutcome = { ok: true; count: number } | { ok: false; reason: RunFailure };

function failed(reason: RunFailure): RunOutcome {
  return { ok: false, reason };
}

function agentFor(deps: AgentDeps, seed: number): AnimationAgent {
  return (deps.createAgent ?? ((s: number) => new MockAnimationAgent(s)))(seed);
}

/**
 * "✦ Auto-generate for this element". The element is described from what the
 * bridge already reported when it was selected; no query goes out.
 */
export async function generateForElement(deps: AgentDeps, vmId: string): Promise<RunOutcome> {
  const state = deps.store.getState();
  // A version being viewed is read-only (Phase 6): a run has no draft to fill.
  if (state.mode === "viewing") return failed("query-failed");
  const element = state.elements[vmId];
  // Selection always stores the element first, so this is a vmId nobody
  // selected: there is nothing to describe to the agent.
  if (!element) return failed("query-failed");

  // Without a page run the fold is unknown, and an unknown fold means `load`:
  // an `in-view` guess on an element already on screen would look like nothing
  // happened.
  const viewport: Viewport = state.lastRun?.viewport ?? {
    width: element.rect.x + element.rect.width,
    height: Number.MAX_SAFE_INTEGER,
  };

  let assignment: Assignment;
  try {
    // The mock reseeds on every call (D7), so a repeat needs a new seed to
    // give a different pick.
    assignment = await agentFor(deps, (deps.now ?? Date.now)()).suggestForElement({
      element,
      existing: state.draftState,
      prompt: state.prompt,
      viewport,
      catalogVersion: CURRENT_VERSION,
    });
  } catch {
    return failed("agent-failed");
  }

  deps.store.getState().applyGenerated(vmId, assignment);
  return { ok: true, count: 1 };
}

/** "✦ Auto-generate for this page", and the result list's Regenerate. */
export async function autoGeneratePage(
  deps: AgentDeps,
  opts: { regenerate?: boolean } = {},
): Promise<RunOutcome> {
  const before = deps.store.getState();
  if (before.mode === "viewing") return failed("query-failed");
  const seed =
    opts.regenerate && before.lastRun ? before.lastRun.seed + 1 : (deps.now ?? Date.now)();
  // Before the query, because the client overwrites `elements` with what it
  // lists. See `restingBox` below.
  const known = before.elements;

  let listed: Awaited<ReturnType<BridgeClient["queryElements"]>>;
  try {
    listed = await deps.bridge.queryElements({
      filter: { tags: [...TARGET_TAGS], minWidth: MIN_TARGET_WIDTH, minHeight: MIN_TARGET_HEIGHT },
      limit: ELEMENTS_QUERY_LIMIT,
    });
  } catch {
    return failed("query-failed");
  }

  // Re-read: the designer may have edited the draft while the query was out.
  const state = deps.store.getState();
  // An element that had an assignment when the list was measured may have
  // been caught mid-animation or held on its first keyframe, and that box is
  // the transformed one — enough to flip `load` to `in-view`, make a target
  // look too small, or move a child out of its card. Its remembered box is the
  // better one, as long as the layout it was measured in still stands: a
  // previous run's viewport that differs from this one means it does not.
  const sameLayout =
    before.lastRun === null ||
    (before.lastRun.viewport.width === listed.viewport.width &&
      before.lastRun.viewport.height === listed.viewport.height);
  const restingBox = (element: ElementInfo): ElementInfo =>
    (sameLayout && before.draftState[element.vmId] !== undefined ? known[element.vmId] : undefined) ??
    element;
  const elements = listed.elements.map(restingBox);
  // The client has just overwritten the remembered boxes with the measured
  // ones. Put the resting ones back, or the next run would "remember" a
  // transformed box. Metadata only: the draft is untouched on every path.
  const restored = elements.filter((element, index) => element !== listed.elements[index]);
  if (restored.length > 0) state.rememberElements(restored);
  const { candidates, existing } = selectAutoCandidates(state, elements);
  if (candidates.length === 0) return failed("no-targets");
  // Nesting is decided against every listed element that holds an entrance,
  // the designer's own included: a hand-animated card is still a block. A
  // hover assignment hides nothing, so it shields nothing.
  const context = elements.filter((element) => {
    const assignment = existing[element.vmId];
    return assignment !== undefined && assignment.trigger !== "hover";
  });

  let suggestion: Awaited<ReturnType<AnimationAgent["suggestForPage"]>>;
  try {
    suggestion = await agentFor(deps, seed).suggestForPage({
      elements: candidates,
      context,
      existing,
      prompt: state.prompt,
      viewport: listed.viewport,
      catalogVersion: CURRENT_VERSION,
    });
  } catch {
    return failed("agent-failed");
  }

  // Only what was asked about. The store would refuse a user-owned element
  // anyway; this also refuses one the agent invented.
  const asked = new Set(candidates.map((element) => element.vmId));
  const assignments = Object.fromEntries(
    Object.entries(suggestion.assignments).filter(([vmId]) => asked.has(vmId)),
  );
  const count = Object.keys(assignments).length;
  if (count === 0) return failed("no-targets");

  deps.store.getState().applyPageSuggestion({
    suggestion: { ...suggestion, assignments },
    seed,
    prompt: state.prompt,
    truncated: listed.truncated,
    viewport: listed.viewport,
  });
  return { ok: true, count };
}
