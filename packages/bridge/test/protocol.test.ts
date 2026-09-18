import { describe, expect, it } from "vitest";

import {
  BULK_APPLY_LIMIT,
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

function applied(over: Partial<AppliedAssignment> = {}): AppliedAssignment {
  return {
    vmId: "vm-heading",
    trigger: "load",
    keyframesName: "vm-fade-in-up-v1-1-0",
    keyframesCss: "@keyframes vm-fade-in-up-v1-1-0 { from { opacity: 0 } to { opacity: 1 } }",
    style: { "animation-duration": "600ms", "--vm-distance": "24px" },
    baseStyles: "",
    animationId: "fade-in-up",
    catalogVersion: "1.1.0",
    params: { duration: "600ms" },
    ...over,
  };
}

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
