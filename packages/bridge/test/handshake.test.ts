import { describe, expect, it } from "vitest";

import { FIXTURE, PARENT_ORIGIN, loadBridge } from "./harness";

describe("handshake", () => {
  it("sends ready once on load with the tagged element count and the protocol version", () => {
    const h = loadBridge(FIXTURE);

    const ready = h.payloads("ready");
    expect(ready).toHaveLength(1);
    expect(ready[0]).toMatchObject({ elementCount: 3, protocolVersion: 1 });
    expect((ready[0] as { bridgeVersion: string }).bridgeVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("posts every message to the parent origin, never to a wildcard", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "hello", payload: {}, seq: 1 });

    expect(h.sent.length).toBeGreaterThan(1);
    for (const message of h.sent) expect(message.targetOrigin).toBe(PARENT_ORIGIN);
  });

  it("sends nothing at all when data-vm-parent-origin is absent", () => {
    const h = loadBridge(FIXTURE, { parentOrigin: null });
    h.send({ type: "hello", payload: {}, seq: 1 });

    expect(h.sent).toEqual([]);
  });

  it("answers hello with a fresh ready and an ack", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "hello", payload: {}, seq: 7 });

    expect(h.payloads("ready")).toHaveLength(2);
    expect(h.lastAck()).toMatchObject({ seq: 7, ok: true });
  });

  it("ignores a message from another origin", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "hello", payload: {}, seq: 1 }, { origin: "http://evil.test" });

    expect(h.acks()).toEqual([]);
    expect(h.payloads("ready")).toHaveLength(1);
  });

  it("ignores a message whose source is not the parent window", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "hello", payload: {}, seq: 1 }, { source: { postMessage() {} } });

    expect(h.acks()).toEqual([]);
    expect(h.payloads("ready")).toHaveLength(1);
  });

  it("ignores a message whose envelope source is not vibe-motion", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "hello", payload: {}, seq: 1, source: "other" });

    expect(h.acks()).toEqual([]);
    expect(h.payloads("ready")).toHaveLength(1);
  });

  it("ignores an unknown type without throwing and without acking", () => {
    const h = loadBridge(FIXTURE);
    expect(() => h.send({ type: "nope", payload: { anything: true }, seq: 5 })).not.toThrow();

    expect(h.acks()).toEqual([]);
  });

  it("ignores the reserved types that later phases own", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "mode", payload: { mode: "view" }, seq: 1 });
    h.send({ type: "elements:query", payload: { limit: 10 }, seq: 2 });

    expect(h.acks()).toEqual([]);
  });

  it("reports the time it spent in the handler", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "hello", payload: {}, seq: 3 });

    const ack = h.lastAck();
    expect(ack).toBeDefined();
    expect(Number.isFinite(ack?.ms)).toBe(true);
    expect(ack?.ms).toBeGreaterThanOrEqual(0);
  });

  it("does not ack a message that carried no seq", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "hello", payload: {} });

    expect(h.payloads("ready")).toHaveLength(2);
    expect(h.acks()).toEqual([]);
  });

  it("keeps the clone from navigating: clicks and submits are prevented in the capture phase", () => {
    const h = loadBridge(`<!doctype html><html><body>
      <a href="https://example.test/away" data-vm-id="vm-link">away</a>
      <form action="/post"><button type="submit">go</button></form>
    </body></html>`);

    const click = h.click(h.el("vm-link"));
    expect(click.defaultPrevented).toBe(true);

    const form = h.document.querySelector("form") as HTMLFormElement;
    const submit = new h.window.Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(true);
  });
});
