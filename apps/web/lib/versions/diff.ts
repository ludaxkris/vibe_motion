/**
 * The client half of "versions are diffs" (CLAUDE.md rule 9): what Save posts,
 * and the same fold the API's `stateAt()` performs, for the History rows and
 * for rebasing a draft after a 409. Pure — no store, no API.
 */
import type { Diff, EditorStateMap, Version } from "@/lib/api-client";
import { assignmentsEqual } from "@/lib/assignment";

export function computeDiff(current: EditorStateMap, draft: EditorStateMap): Diff {
  const set: Diff["set"] = {};
  for (const [vmId, assignment] of Object.entries(draft)) {
    if (!assignmentsEqual(current[vmId], assignment)) set[vmId] = assignment;
  }
  const remove = Object.keys(current).filter((vmId) => !(vmId in draft));
  return { set, remove };
}

/** `set` is applied, then `remove` — the order `openapi.yaml` gives `Diff`. */
export function applyDiff(state: EditorStateMap, diff: Diff): EditorStateMap {
  const next: EditorStateMap = { ...state, ...diff.set };
  for (const vmId of diff.remove) delete next[vmId];
  return next;
}

export function isEmptyDiff(diff: Diff): boolean {
  return Object.keys(diff.set).length === 0 && diff.remove.length === 0;
}

/** State at every version of an ascending list; `result[i]` belongs to `versions[i]`. */
export function statesBySeq(versions: readonly Version[]): EditorStateMap[] {
  const states: EditorStateMap[] = [];
  let state: EditorStateMap = {};
  for (const version of versions) {
    state = applyDiff(state, version.diff);
    states.push(state);
  }
  return states;
}
