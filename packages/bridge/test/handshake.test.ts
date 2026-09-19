import { describe, expect, it, afterEach } from "vitest";

import { FIXTURE, PARENT_ORIGIN, destroyAll, loadBridge } from "./harness";

afterEach(destroyAll);

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

  it("ignores the reserved type that a later phase owns", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "mode", payload: { mode: "view" }, seq: 1 });

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

  it("does not ack a seq that could never be matched", () => {
    const h = loadBridge(FIXTURE);
    h.send({ type: "hello", payload: {}, seq: NaN });
    h.send({ type: "hello", payload: {}, seq: Infinity });

    // The message is still handled; only the uncorrelatable ack is withheld (NaN !== NaN).
    expect(h.payloads("ready")).toHaveLength(3);
    expect(h.acks()).toEqual([]);
  });

  it("fails the ack for a hello it cannot answer yet, rather than claiming success", () => {
    // Only reachable if the script is ever injected without `defer`. The shell must never read
    // a `hello` ack as proof that a `ready` followed (spec D7).
    const h = loadBridge(FIXTURE, { beforeBody: true });

    h.send({ type: "hello", payload: {}, seq: 1 });

    expect(h.payloads("ready")).toEqual([]);
    expect(h.lastAck()).toMatchObject({ seq: 1, ok: false });
    expect(h.lastAck()?.error).toBeUndefined();

    // The DOMContentLoaded ready still arrives, so the shell needs no recovery path.
    h.completeLoad();
    expect(h.payloads("ready")).toHaveLength(1);
    expect(h.payloads("ready")[0]).toMatchObject({ elementCount: 3 });
  });

  it("normalises the parent origin, so a trailing slash is not a half-dead bridge", () => {
    const h = loadBridge(FIXTURE, { parentOrigin: `${PARENT_ORIGIN}/editor/` });

    h.send({ type: "hello", payload: {}, seq: 1 }, { origin: PARENT_ORIGIN });

    expect(h.sent[0].targetOrigin).toBe(PARENT_ORIGIN);
    expect(h.lastAck()).toMatchObject({ seq: 1, ok: true });
  });

  it("treats an unparseable parent origin as no parent at all", () => {
    const h = loadBridge(FIXTURE, { parentOrigin: "not a url" });

    h.send({ type: "hello", payload: {}, seq: 1 });

    expect(h.sent).toEqual([]);
  });

  it("stays an ordinary page when there is no shell to talk to", () => {
    // Someone opened GET /projects/{id}/page directly: it must behave like the page it clones.
    const h = loadBridge(
      `<!doctype html><html><body>
         <a href="https://example.test/away" data-vm-id="vm-link">away</a>
         <form action="/post"><button type="submit">go</button></form>
       </body></html>`,
      { parentOrigin: null },
    );

    expect(h.overlay()).toBeNull();
    expect(h.document.documentElement.getAttribute("data-vm-mode")).toBeNull();
    expect(h.document.documentElement.style.cursor).toBe("");
    expect(h.click(h.el("vm-link")).defaultPrevented).toBe(false);
    const form = h.document.querySelector("form") as HTMLFormElement;
    const submit = new h.window.Event("submit", { bubbles: true, cancelable: true });
    form.dispatchEvent(submit);
    expect(submit.defaultPrevented).toBe(false);
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
