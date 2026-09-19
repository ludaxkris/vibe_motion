/**
 * The shell <-> bridge postMessage contract.
 *
 * Spec: docs/plans/phase-4-bridge-protocol.md. This is a shared contract
 * (CLAUDE.md rule 6): additive changes only once it is on `main`.
 *
 * `vm-bridge.js` cannot import this file — it is a plain browser script with no
 * build step — so it duplicates the three validation regexes below verbatim.
 * `test/protocol.test.ts` and `test/render.test.ts` assert the two copies match.
 */

export const MESSAGE_SOURCE = "vibe-motion" as const;
export const PROTOCOL_VERSION = 1 as const;

/** IntersectionObserver threshold for the `in-view` trigger; reused by the Phase 7 exporter. */
export const IN_VIEW_THRESHOLD = 0.2 as const;

/** More changed draft entries than this in one update => the shell sends `state:load`. */
export const BULK_APPLY_LIMIT = 8 as const;

export const VM_ID_RE = /^vm-[a-z0-9-]+$/;
export const KEYFRAMES_NAME_RE = /^vm-[a-z0-9-]+$/;
export const STYLE_KEY_RE = /^(animation-(?!name$)[a-z-]+|--vm-[a-z0-9-]+)$/;

export type Trigger = "load" | "hover" | "in-view";
export type Rect = { x: number; y: number; width: number; height: number };
export type ElementInfo = {
  vmId: string;
  tag: string;
  role: string | null;
  textPreview: string;
  rect: Rect;
  pageRect: Rect;
  order: number;
  visible: boolean;
};
export type AppliedAssignment = {
  vmId: string;
  trigger: Trigger;
  keyframesName: string;
  keyframesCss: string;
  style: Record<string, string>;
  baseStyles: string;
  animationId: string;
  catalogVersion: string;
  params: Record<string, string>;
};
export type AckError = "unknown-element" | "invalid-payload";

export type Ack = {
  seq: number;
  ms: number;
  ok: boolean;
  error?: AckError;
  /**
   * `state:load` only. The vmIds in the payload that the page does not have; empty when every
   * one was placed. A bulk load is not fatal when the page has moved on, so it applies what it
   * can and names the rest rather than failing (spec §3).
   */
  unknownVmIds?: string[];
};

export type ToShell =
  | { type: "ready"; payload: { elementCount: number; bridgeVersion: string; protocolVersion: number } }
  | { type: "element:hover"; payload: ElementInfo | { vmId: null } }
  | { type: "element:select"; payload: ElementInfo }
  | { type: "element:deselect"; payload: { reason: "escape" | "background" } }
  | { type: "ack"; payload: Ack };

export type ToBridge =
  | { type: "hello"; payload: Record<string, never> }
  | { type: "select"; payload: { vmId: string | null; label?: string; scrollIntoView?: boolean } }
  | { type: "apply"; payload: AppliedAssignment }
  | { type: "clear"; payload: { vmId: string } }
  | { type: "replay"; payload: { vmId: string | null } }
  | { type: "preview"; payload: AppliedAssignment }
  | { type: "preview:clear"; payload: Record<string, never> }
  | { type: "state:load"; payload: { assignments: AppliedAssignment[] } };

export type Envelope<M extends { type: string; payload: unknown }> = M & {
  source: typeof MESSAGE_SOURCE;
  seq?: number;
};

export function isEnvelope(data: unknown): data is Envelope<{ type: string; payload: unknown }> {
  return (
    typeof data === "object" &&
    data !== null &&
    (data as { source?: unknown }).source === MESSAGE_SOURCE &&
    typeof (data as { type?: unknown }).type === "string"
  );
}

/**
 * The same verdict the bridge reaches, on the same input.
 *
 * This is the shell's pre-flight, so it has to agree with `validateApplied` in `vm-bridge.js`
 * exactly, including on input that is not an `AppliedAssignment` at all: a shell that throws on
 * a malformed draft is worse than one that declines to send it. `test/protocol.test.ts` runs a
 * table of payloads through both copies and asserts they never disagree.
 */
export function validateApplied(a: unknown): a is AppliedAssignment {
  if (!a || typeof a !== "object") return false;
  const x = a as Record<string, unknown>;
  if (typeof x.vmId !== "string" || !VM_ID_RE.test(x.vmId)) return false;
  if (typeof x.keyframesName !== "string" || !KEYFRAMES_NAME_RE.test(x.keyframesName)) return false;
  if (x.trigger !== "load" && x.trigger !== "hover" && x.trigger !== "in-view") return false;
  if (typeof x.keyframesCss !== "string" || typeof x.baseStyles !== "string") return false;
  if (!x.style || typeof x.style !== "object") return false;
  const style = x.style as Record<string, unknown>;
  return Object.keys(style).every((key) => STYLE_KEY_RE.test(key) && typeof style[key] === "string");
}
