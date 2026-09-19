/**
 * "Are these two assignments the same assignment?" — once, for everyone.
 *
 * The draft store asks it of `draftState` against `currentVersionState` (the
 * unsaved indicator, the set of dirty elements) and `lib/diff-summary` asks it
 * per element (the Save dialog's change list). Two copies of the comparison
 * would drift the moment `Assignment` gains a field in Phase 6, and only one
 * of the two screens would notice.
 *
 * Structural, not by identity: the draft rebuilds the assignment on every
 * edit, so `===` on the object says nothing. Pure — no catalog, no API.
 */
import type { Assignment } from "@/lib/api-client";

/** True when `a` and `b` describe the same animation, pin, trigger and params. */
export function assignmentsEqual(
  a: Assignment | undefined,
  b: Assignment | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.animationId !== b.animationId) return false;
  if (a.catalogVersion !== b.catalogVersion) return false;
  if (a.trigger !== b.trigger) return false;

  const aKeys = Object.keys(a.params);
  if (aKeys.length !== Object.keys(b.params).length) return false;
  return aKeys.every((key) => a.params[key] === b.params[key]);
}
