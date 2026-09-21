import { afterEach, describe, expect, it, vi } from "vitest";

import { ELEMENTS_QUERY_LIMIT, ELEMENTS_QUERY_MAX, type ElementInfo } from "../src/protocol";
import { type Harness, destroyAll, loadBridge, page } from "./harness";

afterEach(destroyAll);

type ListPayload = {
  seq: number;
  elements: ElementInfo[];
  truncated: boolean;
  viewport: { width: number; height: number };
};

type Box = { x?: number; y?: number; width: number; height: number };

/** jsdom has no layout, so every element that should be measurable gets its box by hand. */
function stubRect(el: Element, box: Box): ReturnType<typeof vi.fn> {
  const x = box.x ?? 0;
  const y = box.y ?? 0;
  const spy = vi.fn(() => ({
    x,
    y,
    left: x,
    top: y,
    right: x + box.width,
    bottom: y + box.height,
    width: box.width,
    height: box.height,
    toJSON() {},
  }));
  (el as unknown as { getBoundingClientRect: unknown }).getBoundingClientRect = spy;
  return spy;
}

/** Give every tagged element the same box, except the ones named in `over`. */
function stubAll(h: Harness, box: Box, over: Record<string, Box> = {}): void {
  h.document.querySelectorAll("[data-vm-id]").forEach((el, i) => {
    const vmId = el.getAttribute("data-vm-id") ?? "";
    stubRect(el, over[vmId] ?? { ...box, y: i * 100 });
  });
}

function lists(h: Harness): ListPayload[] {
  return h.payloads("elements:list") as ListPayload[];
}

function ids(list: ListPayload): string[] {
  return list.elements.map((e) => e.vmId);
}

const MIXED = page(`
  <div data-vm-id="vm-wrap">
    <h1 data-vm-id="vm-h1">Title</h1>
    <p data-vm-id="vm-p">Body copy</p>
    <button data-vm-id="vm-btn">Go</button>
    <div data-vm-id="vm-rolebtn" role="button">Also go</div>
  </div>
`);

function many(n: number): string {
  let body = "";
  for (let i = 0; i < n; i += 1) body += `<p data-vm-id="vm-p${i}">para ${i}</p>`;
  return page(body);
}

describe("elements:query", () => {
  it("posts one elements:list carrying the envelope seq, then the ack, in that order", () => {
    const h = loadBridge(MIXED);
    stubAll(h, { width: 100, height: 100 });
    h.sent.length = 0;

    h.send({ type: "elements:query", payload: {}, seq: 7 });

    expect(h.sent.map((m) => m.data.type)).toEqual(["elements:list", "ack"]);
    expect(lists(h)).toHaveLength(1);
    expect(lists(h)[0].seq).toBe(7);
    expect(lists(h)[0].truncated).toBe(false);
    expect(h.lastAck()).toMatchObject({ seq: 7, ok: true });
  });

  it.each([
    ["no payload key at all", undefined],
    ["a null payload", null],
  ])("treats %s as an empty query", (_name, payload) => {
    const h = loadBridge(MIXED);
    stubAll(h, { width: 100, height: 100 });

    h.send({ type: "elements:query", payload, seq: 1 }, { rawPayload: true });

    expect(lists(h)).toHaveLength(1);
    expect(ids(lists(h)[0])).toEqual(["vm-wrap", "vm-h1", "vm-p", "vm-btn", "vm-rolebtn"]);
    expect(h.lastAck()).toMatchObject({ seq: 1, ok: true });
  });

  it.each([
    ["an array payload", [{ filter: { tags: ["h1"] } }]],
    ["a string payload", "h1"],
    ["a number payload", 5],
  ])("rejects %s as invalid-payload and posts no list", (_name, payload) => {
    const h = loadBridge(MIXED);
    stubAll(h, { width: 100, height: 100 });

    h.send({ type: "elements:query", payload, seq: 4 }, { rawPayload: true });

    expect(lists(h)).toEqual([]);
    expect(h.lastAck()).toMatchObject({ seq: 4, ok: false, error: "invalid-payload" });
  });

  it("lower-cases filter.tags before matching", () => {
    const h = loadBridge(MIXED);
    stubAll(h, { width: 100, height: 100 });

    h.send({ type: "elements:query", payload: { filter: { tags: ["H1", "Button"] } }, seq: 1 });

    expect(ids(lists(h)[0])).toEqual(["vm-h1", "vm-btn", "vm-rolebtn"]);
  });

  it("matches nothing for an empty tags list, and measures nothing", () => {
    const h = loadBridge(MIXED);
    stubAll(h, { width: 100, height: 100 });
    const onH1 = stubRect(h.el("vm-h1"), { width: 100, height: 100 });

    h.send({ type: "elements:query", payload: { filter: { tags: [] } }, seq: 1 });

    expect(lists(h)).toHaveLength(1);
    expect(lists(h)[0].elements).toEqual([]);
    expect(lists(h)[0].truncated).toBe(false);
    expect(h.lastAck()).toMatchObject({ seq: 1, ok: true });
    expect(onH1).not.toHaveBeenCalled();
  });

  it("matches role by token, so a fallback role list containing button counts", () => {
    const h = loadBridge(
      page(`<div data-vm-id="vm-a" role="button link">a</div>
            <div data-vm-id="vm-b" role="  link	BUTTON ">b</div>
            <div data-vm-id="vm-c" role="buttonish">c</div>
            <div data-vm-id="vm-d" role="link">d</div>
            <div data-vm-id="vm-e">e</div>`),
    );
    stubAll(h, { width: 100, height: 100 });

    h.send({ type: "elements:query", payload: { filter: { tags: ["button"] } }, seq: 1 });

    expect(ids(lists(h)[0])).toEqual(["vm-a", "vm-b"]);
  });

  it("writes nothing synchronously even while an element is selected", () => {
    const h = loadBridge(MIXED);
    stubAll(h, { width: 100, height: 100 });
    h.send({ type: "select", payload: { vmId: "vm-h1", label: "h1" }, seq: 1 });
    h.flushRaf();
    const htmlBefore = h.document.documentElement.outerHTML;
    const cssBefore = h.runtimeCss();

    h.send({ type: "elements:query", payload: { filter: { tags: ["h1", "p"] } }, seq: 2 });

    // No flushRaf: the overlay re-sync the bridge schedules after every message lands in a
    // later frame, outside the handler and outside ack.ms.
    expect(lists(h)).toHaveLength(1);
    expect(h.document.documentElement.outerHTML).toBe(htmlBefore);
    expect(h.runtimeCss()).toBe(cssBefore);
  });

  it("lists elements in document order with ascending order", () => {
    const h = loadBridge(MIXED);
    stubAll(h, { width: 100, height: 100 });

    h.send({ type: "elements:query", payload: {}, seq: 1 });

    const list = lists(h)[0];
    expect(ids(list)).toEqual(["vm-wrap", "vm-h1", "vm-p", "vm-btn", "vm-rolebtn"]);
    expect(list.elements.map((e) => e.order)).toEqual([0, 1, 2, 3, 4]);
  });

  it("filters on tags, and role=button matches a button tag filter", () => {
    const h = loadBridge(MIXED);
    stubAll(h, { width: 100, height: 100 });

    h.send({ type: "elements:query", payload: { filter: { tags: ["h1", "button"] } }, seq: 1 });

    expect(ids(lists(h)[0])).toEqual(["vm-h1", "vm-btn", "vm-rolebtn"]);
  });

  it("does not match role=button when the filter has no button tag", () => {
    const h = loadBridge(MIXED);
    stubAll(h, { width: 100, height: 100 });

    h.send({ type: "elements:query", payload: { filter: { tags: ["h1"] } }, seq: 1 });

    expect(ids(lists(h)[0])).toEqual(["vm-h1"]);
  });

  it("never measures an element the tag filter rejects", () => {
    const h = loadBridge(MIXED);
    stubAll(h, { width: 100, height: 100 });
    const onP = stubRect(h.el("vm-p"), { width: 100, height: 100 });
    const onH1 = stubRect(h.el("vm-h1"), { width: 100, height: 100 });

    h.send({ type: "elements:query", payload: { filter: { tags: ["h1"] } }, seq: 1 });

    expect(onH1).toHaveBeenCalled();
    expect(onP).not.toHaveBeenCalled();
  });

  it("drops elements below minWidth / minHeight", () => {
    const h = loadBridge(MIXED);
    stubAll(h, { width: 100, height: 100 }, { "vm-p": { width: 30, height: 200 }, "vm-btn": { width: 200, height: 39 } });

    h.send({ type: "elements:query", payload: { filter: { minWidth: 40, minHeight: 40 } }, seq: 1 });

    expect(ids(lists(h)[0])).toEqual(["vm-wrap", "vm-h1", "vm-rolebtn"]);
  });

  it("never lists an invisible element, with or without a filter", () => {
    const h = loadBridge(
      page(`<h1 data-vm-id="vm-a">a</h1><h1 data-vm-id="vm-zero">zero</h1>
            <h1 data-vm-id="vm-hidden" style="visibility:hidden">hidden</h1>
            <h1 data-vm-id="vm-none" style="display:none">none</h1>`),
    );
    stubAll(h, { width: 100, height: 100 }, { "vm-zero": { width: 0, height: 0 } });

    h.send({ type: "elements:query", payload: {}, seq: 1 });
    h.send({ type: "elements:query", payload: { filter: { tags: ["h1"], minWidth: 0, minHeight: 0 } }, seq: 2 });

    expect(ids(lists(h)[0])).toEqual(["vm-a"]);
    expect(ids(lists(h)[1])).toEqual(["vm-a"]);
  });

  it("stops at limit and says it truncated", () => {
    const h = loadBridge(many(5));
    stubAll(h, { width: 100, height: 100 });

    h.send({ type: "elements:query", payload: { limit: 2 }, seq: 1 });

    expect(ids(lists(h)[0])).toEqual(["vm-p0", "vm-p1"]);
    expect(lists(h)[0].truncated).toBe(true);
  });

  it("is not truncated when exactly limit elements match", () => {
    const h = loadBridge(many(5));
    stubAll(h, { width: 100, height: 100 });

    h.send({ type: "elements:query", payload: { limit: 5 }, seq: 1 });

    expect(lists(h)[0].elements).toHaveLength(5);
    expect(lists(h)[0].truncated).toBe(false);
  });

  it("defaults the limit to 200 and clamps it to [1, 500]", () => {
    const h = loadBridge(many(510));
    stubAll(h, { width: 100, height: 100 });

    h.send({ type: "elements:query", payload: {}, seq: 1 });
    h.send({ type: "elements:query", payload: { limit: 9999 }, seq: 2 });
    h.send({ type: "elements:query", payload: { limit: 0 }, seq: 3 });
    h.send({ type: "elements:query", payload: { limit: -4 }, seq: 4 });
    h.send({ type: "elements:query", payload: { limit: 2.9 }, seq: 5 });

    const all = lists(h);
    expect(all[0].elements).toHaveLength(ELEMENTS_QUERY_LIMIT);
    expect(all[0].elements).toHaveLength(200);
    expect(all[0].truncated).toBe(true);
    expect(all[1].elements).toHaveLength(ELEMENTS_QUERY_MAX);
    expect(all[1].elements).toHaveLength(500);
    expect(all[1].truncated).toBe(true);
    expect(all[2].elements).toHaveLength(1);
    expect(all[3].elements).toHaveLength(1);
    expect(all[4].elements).toHaveLength(2);
  });

  it("reports the viewport", () => {
    const h = loadBridge(MIXED);
    stubAll(h, { width: 100, height: 100 });

    h.send({ type: "elements:query", payload: {}, seq: 1 });

    expect(lists(h)[0].viewport).toEqual({ width: h.window.innerWidth, height: h.window.innerHeight });
    expect(lists(h)[0].viewport.width).toBeGreaterThan(0);
  });

  it.each([
    ["a string filter", { filter: "x" }],
    ["a null filter", { filter: null }],
    ["an array filter", { filter: [{ tags: ["h1"] }] }],
    ["tags that are not an array", { filter: { tags: "h1" } }],
    ["a tags entry that is not a string", { filter: { tags: ["h1", 1] } }],
    ["a null tags entry", { filter: { tags: [null] } }],
    ["a string limit", { limit: "2" }],
    ["a NaN limit", { limit: NaN }],
    ["an infinite limit", { limit: Infinity }],
    ["a NaN minWidth", { filter: { minWidth: NaN } }],
    ["a string minWidth", { filter: { minWidth: "40" } }],
    ["a NaN minHeight", { filter: { minHeight: NaN } }],
    ["an infinite minHeight", { filter: { minHeight: -Infinity } }],
  ])("rejects %s as invalid-payload and posts no list", (_name, payload) => {
    const h = loadBridge(MIXED);
    stubAll(h, { width: 100, height: 100 });

    h.send({ type: "elements:query", payload, seq: 3 });

    expect(lists(h)).toEqual([]);
    expect(h.lastAck()).toMatchObject({ seq: 3, ok: false, error: "invalid-payload" });
  });

  it("posts nothing for a query that carried no seq", () => {
    const h = loadBridge(MIXED);
    stubAll(h, { width: 100, height: 100 });
    h.sent.length = 0;

    h.send({ type: "elements:query", payload: {} });
    h.send({ type: "elements:query", payload: { filter: "x" } });
    h.send({ type: "elements:query", payload: {}, seq: "7" as unknown as number });
    h.send({ type: "elements:query", payload: {}, seq: NaN });
    h.send({ type: "elements:query", payload: {}, seq: Infinity });

    expect(h.sent).toEqual([]);
  });

  it("never lists overlay nodes", () => {
    const h = loadBridge(MIXED);
    // Everything measurable, overlay included, so only tagging keeps the overlay out.
    const proto = h.window.Element.prototype as unknown as { getBoundingClientRect: unknown };
    proto.getBoundingClientRect = () => ({ x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 100, width: 100, height: 100 });
    h.send({ type: "select", payload: { vmId: "vm-h1", label: "h1" }, seq: 1 });
    h.flushRaf();
    expect(h.overlay()).not.toBeNull();

    h.send({ type: "elements:query", payload: {}, seq: 2 });

    const list = lists(h)[0];
    expect(ids(list)).toEqual(["vm-wrap", "vm-h1", "vm-p", "vm-btn", "vm-rolebtn"]);
    for (const vmId of ids(list)) expect(h.overlay()?.contains(h.el(vmId))).toBe(false);
  });

  it("writes no styles while answering", () => {
    const h = loadBridge(MIXED);
    stubAll(h, { width: 100, height: 100 });
    const htmlBefore = h.document.documentElement.outerHTML;
    const cssBefore = h.runtimeCss();

    h.send({ type: "elements:query", payload: { filter: { tags: ["h1", "p"] } }, seq: 1 });

    expect(h.document.documentElement.outerHTML).toBe(htmlBefore);
    expect(h.runtimeCss()).toBe(cssBefore);
  });

  it("announces a bridge version at or above the floor its own behaviour needs", () => {
    const h = loadBridge(MIXED);
    const ready = h.payloads("ready")[0] as { bridgeVersion: string; protocolVersion: number };

    expect(ready).toMatchObject({ bridgeVersion: expect.stringMatching(/^\d+\.\d+\.\d+$/), protocolVersion: 1 });
    // A floor, not an equality: pinning the literal only records which release last touched this
    // file, but dropping it entirely would leave nothing in the repo that fails when a behaviour
    // change ships without a bump (Kotlin parses the version, the web client compares it). The
    // floor is the newest version whose behaviour something depends on — `elements:query` shipped
    // in 1.1.0, the in-view reachability rule in 1.1.2, resting-box `ElementInfo` in 1.1.3 — and the compare is numeric, as the
    // README prescribes, so a patch bump can never read as "older".
    const atLeast = (version: string, floor: string) => {
      const [major, minor, patch] = version.split(".").map(Number);
      const [fMajor, fMinor, fPatch] = floor.split(".").map(Number);
      if (major !== fMajor) return major > fMajor;
      if (minor !== fMinor) return minor > fMinor;
      return patch >= fPatch;
    };
    expect(atLeast(ready.bridgeVersion, "1.1.3")).toBe(true);
    expect(atLeast("1.10.0", "1.1.3")).toBe(true);
    expect(atLeast("1.1.2", "1.1.3")).toBe(false);
  });
});
