/**
 * Draft `Assignment` -> the `AppliedAssignment` the bridge renders.
 *
 * The bridge is a dumb renderer (spec D1): it never reads the catalog and
 * never builds a keyframes name, so every byte of CSS in the payload is
 * computed here, from the catalog version the assignment *pinned* — not from
 * the current one (CLAUDE.md rule 9). A draft that mixes versions therefore
 * renders each element against its own pin, which is the whole point of
 * pinning.
 *
 * Pure: no store, no DOM, no network.
 */
import { getCatalog, getEntry, keyframesName } from "animation-catalog";
import { validateApplied, type AppliedAssignment } from "bridge";

import type { Assignment } from "@/lib/api-client";
import { assignmentStyle, keyframesCss, resolveParams } from "@/lib/runtime-css";

/**
 * Why an assignment could not be turned into a payload.
 *
 * The first two are drafts pointing at a catalog that has moved (or at a
 * version this build does not carry). `invalid-payload` is ours: the finished
 * payload failed the bridge's own validation, which can only happen if the
 * catalog grew a param whose CSS property the protocol does not allow. It is
 * a catalog bug, and it is better surfaced in the panel than posted to a
 * bridge that will refuse it.
 */
export type UnresolvedReason = "unknown-version" | "unknown-animation" | "invalid-payload";

export type Unresolved = {
  vmId: string;
  reason: UnresolvedReason;
  animationId: string;
  catalogVersion: string;
};

export function isUnresolved(value: AppliedAssignment | Unresolved): value is Unresolved {
  return "reason" in value;
}

export function toApplied(vmId: string, assignment: Assignment): AppliedAssignment | Unresolved {
  const { animationId, catalogVersion } = assignment;
  const unresolved = (reason: UnresolvedReason): Unresolved => ({
    vmId,
    reason,
    animationId,
    catalogVersion,
  });

  // Told apart on purpose: a version this build has never heard of is a
  // deployment problem, a missing id inside a known version is a catalog one,
  // and the panel says something different about each.
  if (!getCatalog(catalogVersion)) return unresolved("unknown-version");
  const entry = getEntry(catalogVersion, animationId);
  if (!entry) return unresolved("unknown-animation");

  const applied: AppliedAssignment = {
    vmId,
    trigger: assignment.trigger,
    // Always from the package (DT-047): the name encodes the full pinned
    // version, and building it here would be one more place to get it wrong.
    keyframesName: keyframesName(animationId, catalogVersion),
    keyframesCss: keyframesCss(entry, catalogVersion),
    style: animationStyle(entry, catalogVersion, assignment.params),
    baseStyles: entry.baseStyles ?? "",
    animationId,
    catalogVersion,
    params: resolveParams(entry, assignment.params),
  };

  // The same check the bridge runs, on the same input, so the client cannot
  // post something that will come back `invalid-payload`.
  return validateApplied(applied) ? applied : unresolved("invalid-payload");
}

/**
 * Exactly the properties that belong in `AppliedAssignment.style`: the
 * `animation-*` longhands and `--vm-*` custom properties the params produce.
 *
 * Two things are deliberately left out. `animation-name` is the bridge's —
 * it owns writing and withholding it as the trigger arms (spec D3), which is
 * why `STYLE_KEY_RE` rejects the key outright. And the entry's `baseStyles`,
 * which `assignmentStyle` merges in underneath everything else, travel in the
 * payload's own `baseStyles` string and land in a `[data-vm-id="…"]` rule
 * (spec §4) — `transform-origin` and friends are not animation properties and
 * would fail validation here. Resolving the entry *without* its base styles is
 * how that split is made without this module re-deriving which catalog param
 * maps to which CSS property; `lib/runtime-css` stays the only place that
 * knows. Inline still beats the rule, so a param that overrides a base
 * declaration keeps winning.
 */
function animationStyle(
  entry: NonNullable<ReturnType<typeof getEntry>>,
  catalogVersion: string,
  params: Readonly<Record<string, string>>,
): Record<string, string> {
  const style = assignmentStyle({ ...entry, baseStyles: undefined }, catalogVersion, params);
  delete style["animation-name"];
  return style;
}
