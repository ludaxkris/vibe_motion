import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it } from "vitest";

import { FIXTURE, applied as appliedFixture, destroyAll, loadBridge } from "./harness";

import {
  BULK_APPLY_LIMIT,
  ELEMENTS_QUERY_LIMIT,
  ELEMENTS_QUERY_MAX,
  IN_VIEW_THRESHOLD,
  KEYFRAMES_NAME_RE,
  MESSAGE_SOURCE,
  PROTOCOL_VERSION,
  STYLE_KEY_RE,
  VM_ID_RE,
  isEnvelope,
  validateApplied,
} from "../src/protocol";
import type { AppliedAssignment } from "../src/protocol";

const applied = appliedFixture;

afterEach(destroyAll);

describe("constants", () => {
  it("pins the values the bridge, the shell and the Phase 7 exporter share", () => {
    expect(MESSAGE_SOURCE).toBe("vibe-motion");
    expect(PROTOCOL_VERSION).toBe(1);
    expect(IN_VIEW_THRESHOLD).toBe(0.2);
    expect(BULK_APPLY_LIMIT).toBe(8);
  });
});

describe("isEnvelope", () => {
  it("accepts a well-formed envelope", () => {
    expect(isEnvelope({ source: "vibe-motion", type: "apply", payload: {}, seq: 1 })).toBe(true);
  });

  it("rejects null", () => {
    expect(isEnvelope(null)).toBe(false);
  });

  it("rejects a foreign source", () => {
    expect(isEnvelope({ source: "other", type: "apply", payload: {} })).toBe(false);
  });

  it("rejects a missing type", () => {
    expect(isEnvelope({ source: "vibe-motion", payload: {} })).toBe(false);
  });
});

describe("validateApplied", () => {
  it("accepts a well-formed assignment", () => {
    expect(validateApplied(applied())).toBe(true);
  });

  it("rejects a vmId that could break out of an attribute selector", () => {
    expect(validateApplied(applied({ vmId: 'vm-1"]{}' }))).toBe(false);
  });

  it("rejects an unprefixed keyframes name", () => {
    expect(validateApplied(applied({ keyframesName: "fade-in" }))).toBe(false);
  });

  it("rejects animation-name as a style key", () => {
    expect(validateApplied(applied({ style: { "animation-name": "vm-fade-in-v1-1-0" } }))).toBe(false);
  });

  it("rejects a non-animation, non-vm style key", () => {
    expect(validateApplied(applied({ style: { color: "red" } }))).toBe(false);
  });

  it("rejects an unknown trigger", () => {
    expect(validateApplied(applied({ trigger: "click" as unknown as AppliedAssignment["trigger"] }))).toBe(false);
  });
});

describe("parity with the bridge script", () => {
  const source = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "vm-bridge.js"), "utf8");

  it("duplicates every shared constant verbatim", () => {
    expect(source).toContain(`var MESSAGE_SOURCE = "${MESSAGE_SOURCE}";`);
    expect(source).toContain(`var PROTOCOL_VERSION = ${PROTOCOL_VERSION};`);
    expect(source).toContain(`var IN_VIEW_THRESHOLD = ${IN_VIEW_THRESHOLD};`);
    expect(source).toContain(`var VM_ID_RE = /${VM_ID_RE.source}/;`);
    expect(source).toContain(`var KEYFRAMES_NAME_RE = /${KEYFRAMES_NAME_RE.source}/;`);
    expect(source).toContain(`var STYLE_KEY_RE = /${STYLE_KEY_RE.source}/;`);
    expect(source).toContain(`var ELEMENTS_QUERY_LIMIT = ${ELEMENTS_QUERY_LIMIT};`);
    expect(source).toContain(`var ELEMENTS_QUERY_MAX = ${ELEMENTS_QUERY_MAX};`);
    expect(ELEMENTS_QUERY_LIMIT).toBe(200);
    expect(ELEMENTS_QUERY_MAX).toBe(500);
  });

  it("declares BRIDGE_VERSION on one line the API can regex out", () => {
    // `BridgeAssets.kt` parses this with Regex("""BRIDGE_VERSION\s*=\s*"([^"]+)""""), so the
    // shape of this line is a contract with the Kotlin side, not a style preference.
    const matches = source.match(/^ {2}var BRIDGE_VERSION = "(\d+\.\d+\.\d+)";$/m);
    expect(matches).not.toBeNull();
    expect(matches?.[1]).toMatch(/^\d+\.\d+\.\d+$/);
  });

  /**
   * The shell pre-flights with `protocol.ts` and the bridge decides with its own copy. If the
   * two ever disagree, the shell either sends something that will be rejected or declines
   * something that would have worked, so they are checked against the same table.
   */
  it("reaches the same verdict as the bridge on every payload, and never throws", () => {
    const h = loadBridge(FIXTURE);
    const payloads: unknown[] = [
      applied(),
      applied({ trigger: "hover" }),
      applied({ trigger: "in-view" }),
      applied({ style: {} }),
      applied({ baseStyles: "transform-origin: center;" }),
      applied({ vmId: 'vm-1"]{}' }),
      applied({ vmId: "VM-Heading" }),
      applied({ keyframesName: "fade-in" }),
      applied({ style: { "animation-name": "vm-x" } }),
      applied({ style: { color: "red" } }),
      applied({ style: { "--other": "1px" } }),
      applied({ trigger: "click" as unknown as AppliedAssignment["trigger"] }),
      { ...applied(), style: { "animation-duration": 600 } },
      { ...applied(), style: null },
      { ...applied(), style: undefined },
      { ...applied(), vmId: 12 },
      { ...applied(), keyframesCss: null },
      { ...applied(), baseStyles: 7 },
      {},
      null,
      undefined,
      "vm-heading",
      42,
      [],
    ];

    for (const payload of payloads) {
      const fromProtocol = validateApplied(payload);
      h.send({ type: "apply", payload, seq: 1 });
      const ack = h.lastAck();
      // The bridge only reaches `unknown-element` once the payload has passed validation, so
      // "not invalid-payload" is its verdict on the shape.
      const fromBridge = ack?.error !== "invalid-payload";
      expect({ payload, verdict: fromProtocol }).toEqual({ payload, verdict: fromBridge });
      h.sent.length = 0;
    }
  });
});

describe("STYLE_KEY_RE", () => {
  it("accepts animation longhands and vm custom properties", () => {
    expect(STYLE_KEY_RE.test("animation-duration")).toBe(true);
    expect(STYLE_KEY_RE.test("animation-fill-mode")).toBe(true);
    expect(STYLE_KEY_RE.test("--vm-distance")).toBe(true);
  });

  it("rejects animation-name and anything outside the allow-list", () => {
    expect(STYLE_KEY_RE.test("animation-name")).toBe(false);
    expect(STYLE_KEY_RE.test("color")).toBe(false);
    expect(STYLE_KEY_RE.test("--other")).toBe(false);
  });
});

describe("id regexes", () => {
  it("require the vm- prefix and a safe character set", () => {
    expect(VM_ID_RE.test("vm-heading")).toBe(true);
    expect(VM_ID_RE.test("vm-Heading")).toBe(false);
    expect(KEYFRAMES_NAME_RE.test("vm-fade-in-up-v1-1-0")).toBe(true);
    expect(KEYFRAMES_NAME_RE.test("fade-in")).toBe(false);
  });
});
