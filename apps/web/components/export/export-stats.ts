import type { EditorStateMap } from "@/lib/api-client";

/** What the Export tab's footer line counts, when it can count anything. */
export type ExportCounts = {
  /** Distinct animations used, however many elements each is on. */
  animations: number;
  /** Elements carrying an assignment. */
  elements: number;
};

/**
 * What the footer can say about a materialised version state, so the line
 * needs no new field on `ExportBundle` and the Phase 0 contract stays as it is.
 *
 * "Animations" is the number of *distinct* animations, which is how a designer
 * reads the line — the same animation on four elements is one animation, and
 * the same animation pinned to two catalog versions is still one animation
 * with two keyframes blocks behind it.
 *
 * Both counts are over the state the export actually covers: the whole version
 * in full mode, the one selected element in snippet mode.
 *
 * `undefined` in, `undefined` out: a caller that has no state must print no
 * counts rather than "0 animations · 0 elements" under a non-empty export.
 */
export function exportCounts(state: EditorStateMap | undefined): ExportCounts | undefined {
  if (state === undefined) return undefined;
  const assignments = Object.values(state);
  return {
    animations: new Set(assignments.map((assignment) => assignment.animationId)).size,
    elements: assignments.length,
  };
}

function count(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}

/**
 * The handoff's footer line: "2 animations · 4 elements · js not needed (no
 * in-view triggers)" (`docs/design/README.md`, "Export tab").
 *
 * `needsJs` is a fact about the *bundle*, never about client state: the footer
 * and the zip must not be able to disagree about whether the script is in the
 * download. With no counts to show, the line is the script clause alone.
 */
export function formatExportStats(counts: ExportCounts | undefined, needsJs: boolean): string {
  const script = needsJs
    ? "includes vibe-motion.js (in-view triggers)"
    : "js not needed (no in-view triggers)";
  if (counts === undefined) return script;
  return `${count(counts.animations, "animation")} · ${count(counts.elements, "element")} · ${script}`;
}
