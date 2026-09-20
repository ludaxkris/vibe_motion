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
import { MIN_TARGET_SIZE, TARGET_TAGS } from "./targets";
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
  const seed =
    opts.regenerate && before.lastRun ? before.lastRun.seed + 1 : (deps.now ?? Date.now)();
  // Before the query, because the client overwrites `elements` with what it
  // lists: on a Regenerate the page is animated, and a box measured
  // mid-animation is the transformed one — enough to flip `load` to `in-view`
  // or make a target look too small.
  const known: Record<string, ElementInfo> = opts.regenerate ? before.elements : {};

  let listed: Awaited<ReturnType<BridgeClient["queryElements"]>>;
  try {
    listed = await deps.bridge.queryElements({
      filter: { tags: [...TARGET_TAGS], minWidth: MIN_TARGET_SIZE, minHeight: MIN_TARGET_SIZE },
      limit: ELEMENTS_QUERY_LIMIT,
    });
  } catch {
    return failed("query-failed");
  }

  // Re-read: the designer may have edited the draft while the query was out.
  const state = deps.store.getState();
  const elements = listed.elements.map((element) => known[element.vmId] ?? element);
  const { candidates, existing } = selectAutoCandidates(state, elements);
  if (candidates.length === 0) return failed("no-targets");

  let suggestion: Awaited<ReturnType<AnimationAgent["suggestForPage"]>>;
  try {
    suggestion = await agentFor(deps, seed).suggestForPage({
      elements: candidates,
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
