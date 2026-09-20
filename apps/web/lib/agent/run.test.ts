import { ELEMENTS_QUERY_LIMIT, type ElementInfo } from "bridge";
import { describe, expect, it, vi } from "vitest";

import type { ElementsList } from "@/lib/bridge";
import { createEditorStore, selectAgentOwnedVmIds, selectAutoResultVmIds } from "@/lib/store";

import { MockAnimationAgent } from "./mock-agent";
import { autoGeneratePage, generateForElement, type AgentDeps } from "./run";
import { MIN_TARGET_HEIGHT, MIN_TARGET_WIDTH, TARGET_TAGS } from "./targets";
import type { AnimationAgent } from "./types";

const VIEWPORT = { width: 1200, height: 600 };

function el(vmId: string, tag: string, order: number, y = order * 100): ElementInfo {
  return {
    vmId,
    tag,
    role: null,
    textPreview: vmId,
    rect: { x: 0, y, width: 300, height: 80 },
    pageRect: { x: 0, y, width: 300, height: 80 },
    order,
    visible: true,
  };
}

const PAGE = [el("vm-h1", "h1", 0), el("vm-p", "p", 1), el("vm-cta", "a", 2), el("vm-low", "h2", 3, 2000)];

function setup(
  options: {
    elements?: ElementInfo[];
    list?: Partial<ElementsList>;
    reject?: Error;
    createAgent?: AgentDeps["createAgent"];
  } = {},
) {
  const store = createEditorStore();
  const queryElements = vi.fn(async (): Promise<ElementsList> => {
    if (options.reject) throw options.reject;
    return { elements: options.elements ?? PAGE, truncated: false, viewport: VIEWPORT, ...options.list };
  });
  const seeds: number[] = [];
  let clock = 1000;
  const deps: AgentDeps = {
    store,
    bridge: { queryElements },
    createAgent:
      options.createAgent ??
      ((seed) => {
        seeds.push(seed);
        return new MockAnimationAgent(seed);
      }),
    now: () => (clock += 1),
  };
  return { store, deps, queryElements, seeds };
}

describe("autoGeneratePage", () => {
  it("queries with the target filter, applies the suggestion and lands on auto", async () => {
    const { store, deps, queryElements, seeds } = setup({ list: { truncated: true } });
    store.getState().setPrompt("calm");

    const outcome = await autoGeneratePage(deps);

    expect(queryElements).toHaveBeenCalledExactlyOnceWith({
      filter: { tags: [...TARGET_TAGS], minWidth: MIN_TARGET_WIDTH, minHeight: MIN_TARGET_HEIGHT },
      limit: ELEMENTS_QUERY_LIMIT,
    });
    expect(outcome).toEqual({ ok: true, count: 4 });
    const state = store.getState();
    expect(state.panel).toEqual({ status: "auto" });
    expect(Object.keys(state.draftState).sort()).toEqual(["vm-cta", "vm-h1", "vm-low", "vm-p"]);
    expect(state.lastRun).toMatchObject({ seed: 1001, prompt: "calm", truncated: true, viewport: VIEWPORT });
    expect(seeds).toEqual([1001]);
    // D6: hover for the link, load above the fold, in-view below it.
    expect(state.draftState["vm-cta"].trigger).toBe("hover");
    expect(state.draftState["vm-h1"].trigger).toBe("load");
    expect(state.draftState["vm-low"].trigger).toBe("in-view");
    expect(state.currentVersionState).toEqual({});
  });

  it("a rejecting bridge is query-failed and the store is untouched", async () => {
    const { store, deps } = setup({ reject: new Error("elements-query-timeout") });
    store.getState().setDraftAssignment("vm-h1", {
      animationId: "pulse",
      catalogVersion: "1.1.0",
      trigger: "load",
      params: {},
    });
    const before = store.getState();

    await expect(autoGeneratePage(deps)).resolves.toEqual({ ok: false, reason: "query-failed" });

    expect(store.getState().draftState).toEqual(before.draftState);
    expect(store.getState().lastRun).toBeNull();
    expect(store.getState().panel).toEqual({ status: "idle" });
  });

  it("a page with nothing worth animating is no-targets and writes nothing", async () => {
    const { store, deps } = setup({ elements: [el("vm-d1", "div", 0), el("vm-d2", "div", 1)] });

    await expect(autoGeneratePage(deps)).resolves.toEqual({ ok: false, reason: "no-targets" });

    expect(store.getState().draftState).toEqual({});
    expect(store.getState().generated).toEqual({});
    expect(store.getState().lastRun).toBeNull();
    expect(store.getState().panel).toEqual({ status: "idle" });
  });

  it("an empty list is no-targets", async () => {
    const { deps } = setup({ elements: [] });
    await expect(autoGeneratePage(deps)).resolves.toEqual({ ok: false, reason: "no-targets" });
  });

  it.each([
    ["rejecting", (): AnimationAgent => ({
      suggestForElement: () => Promise.reject(new Error("boom")),
      suggestForPage: () => Promise.reject(new Error("boom")),
    })],
    ["throwing", (): AnimationAgent => ({
      suggestForElement: () => {
        throw new Error("boom");
      },
      suggestForPage: () => {
        throw new Error("boom");
      },
    })],
    ["unconstructable", (): AnimationAgent => {
      throw new Error("no agent");
    }],
  ])("a %s agent is agent-failed and the draft is untouched", async (_name, createAgent) => {
    const { store, deps } = setup({ createAgent });
    store.getState().rememberElement(PAGE[0]);
    store.getState().setSelectedVmId("vm-h1");

    await expect(autoGeneratePage(deps)).resolves.toEqual({ ok: false, reason: "agent-failed" });
    await expect(generateForElement(deps, "vm-h1")).resolves.toEqual({ ok: false, reason: "agent-failed" });

    expect(store.getState().draftState).toEqual({});
    expect(store.getState().generated).toEqual({});
    expect(store.getState().lastRun).toBeNull();
  });

  it("hands user-owned work to the agent as context and never assigns it", async () => {
    const seen: { elements: string[]; existing: string[]; prompt: string }[] = [];
    const mine = { animationId: "shake", catalogVersion: "1.1.0", trigger: "load" as const, params: {} };
    const { store, deps } = setup({
      createAgent: (seed) => {
        const real = new MockAnimationAgent(seed);
        return {
          suggestForElement: (ctx) => real.suggestForElement(ctx),
          suggestForPage: async (ctx) => {
            seen.push({
              elements: ctx.elements.map((element) => element.vmId),
              existing: Object.keys(ctx.existing),
              prompt: ctx.prompt,
            });
            const suggestion = await real.suggestForPage(ctx);
            // A misbehaving agent that answers for an element it was not asked about.
            return { ...suggestion, assignments: { ...suggestion.assignments, "vm-rogue": mine } };
          },
        };
      },
    });
    store.getState().setPrompt("lively");
    store.getState().setDraftAssignment("vm-h1", mine);

    const outcome = await autoGeneratePage(deps);

    expect(seen).toEqual([{ elements: ["vm-p", "vm-cta", "vm-low"], existing: ["vm-h1"], prompt: "lively" }]);
    expect(outcome).toEqual({ ok: true, count: 3 });
    expect(store.getState().draftState["vm-h1"]).toBe(mine);
    expect(store.getState().draftState["vm-rogue"]).toBeUndefined();
  });

  it("is no-targets when everything listed is already the user's", async () => {
    const { store, deps } = setup({ elements: [PAGE[0]] });
    store.getState().setDraftAssignment("vm-h1", {
      animationId: "shake",
      catalogVersion: "1.1.0",
      trigger: "load",
      params: {},
    });

    await expect(autoGeneratePage(deps)).resolves.toEqual({ ok: false, reason: "no-targets" });
    expect(store.getState().lastRun).toBeNull();
  });

  it("regenerate re-rolls with seed + 1 and leaves a hand-tuned element identical", async () => {
    const { store, deps, seeds } = setup();
    await autoGeneratePage(deps);
    store.getState().updateDraftParam("vm-h1", "duration", "1250ms");
    const tuned = store.getState().draftState["vm-h1"];

    const outcome = await autoGeneratePage(deps, { regenerate: true });

    expect(outcome).toEqual({ ok: true, count: 3 });
    expect(seeds).toEqual([1001, 1002]);
    expect(store.getState().lastRun?.seed).toBe(1002);
    expect(store.getState().draftState["vm-h1"]).toBe(tuned);
    expect(selectAutoResultVmIds(store.getState())).toContain("vm-h1");
    expect(selectAgentOwnedVmIds(store.getState())).not.toContain("vm-h1");
    expect(store.getState().panel).toEqual({ status: "auto" });
  });

  it("regenerate without a previous run seeds from the clock", async () => {
    const { store, deps } = setup();

    await autoGeneratePage(deps, { regenerate: true });

    expect(store.getState().lastRun?.seed).toBe(1001);
  });

  it("regenerate measures a known element from the snapshot, not from a box caught mid-animation", async () => {
    const { store, deps, queryElements } = setup();
    await autoGeneratePage(deps);
    expect(store.getState().draftState["vm-h1"].trigger).toBe("load");

    // The second listing catches vm-h1 translated far below the fold, and the
    // client overwrites `store.elements` with it before the agent runs.
    const moved = PAGE.map((element) =>
      element.vmId === "vm-h1" ? { ...element, pageRect: { ...element.pageRect, y: 5000 } } : element,
    );
    queryElements.mockImplementationOnce(async () => {
      store.getState().rememberElements(moved);
      return { elements: moved, truncated: false, viewport: VIEWPORT };
    });
    store.getState().rememberElements(PAGE);

    await autoGeneratePage(deps, { regenerate: true });

    expect(store.getState().draftState["vm-h1"].trigger).toBe("load");
  });

  it("a first run trusts the fresh measurement", async () => {
    const stale = { ...PAGE[0], pageRect: { ...PAGE[0].pageRect, y: 5000 } };
    const { store, deps } = setup();
    store.getState().rememberElement(stale);

    await autoGeneratePage(deps);

    expect(store.getState().draftState["vm-h1"].trigger).toBe("load");
  });
});

describe("generateForElement", () => {
  it("assigns the selected element and lands on tuning", async () => {
    const { store, deps } = setup();
    store.getState().rememberElement(PAGE[2]);
    store.getState().setSelectedVmId("vm-cta");

    const outcome = await generateForElement(deps, "vm-cta");

    expect(outcome).toEqual({ ok: true, count: 1 });
    const assignment = store.getState().draftState["vm-cta"];
    expect(assignment.trigger).toBe("hover");
    expect(store.getState().generated["vm-cta"]).toBe(assignment);
    expect(store.getState().panel).toEqual({
      status: "tuning",
      vmId: "vm-cta",
      animationId: assignment.animationId,
    });
    expect(store.getState().lastRun).toBeNull();
  });

  it("with no fold known, treats the element as above it (load)", async () => {
    const { store, deps } = setup();
    store.getState().rememberElement(PAGE[3]); // y: 2000
    store.getState().setSelectedVmId("vm-low");

    await generateForElement(deps, "vm-low");

    expect(store.getState().draftState["vm-low"].trigger).toBe("load");
  });

  it("uses the last run's viewport when there is one", async () => {
    const { store, deps } = setup();
    store.getState().rememberElements(PAGE); // what the real client does with a list
    await autoGeneratePage(deps);
    store.getState().removeDraftAssignment("vm-low");
    store.getState().setSelectedVmId("vm-low");

    await generateForElement(deps, "vm-low");

    expect(store.getState().draftState["vm-low"].trigger).toBe("in-view");
  });

  it("takes a new seed on every call", async () => {
    const { store, deps, seeds } = setup();
    store.getState().rememberElement(PAGE[0]);

    await generateForElement(deps, "vm-h1");
    await generateForElement(deps, "vm-h1");

    expect(seeds).toEqual([1001, 1002]);
  });

  it("is query-failed for an element the bridge never described", async () => {
    const { store, deps } = setup();

    await expect(generateForElement(deps, "vm-ghost")).resolves.toEqual({ ok: false, reason: "query-failed" });
    expect(store.getState().draftState).toEqual({});
  });

  it("never asks the bridge anything", async () => {
    const { store, deps, queryElements } = setup();
    store.getState().rememberElement(PAGE[0]);

    await generateForElement(deps, "vm-h1");

    expect(queryElements).not.toHaveBeenCalled();
  });
});
