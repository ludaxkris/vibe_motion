import type { EditorStateMap } from "@/lib/api-client";

/** What the Export tab's footer line counts. */
export type ExportStats = {
  /** Distinct animations used, however many elements each is on. */
  animations: number;
  /** Elements carrying an assignment. */
  elements: number;
  /** Whether some assignment uses `in-view`, which is what needs the script. */
  needsJs: boolean;
};

/**
 * What the footer says about a materialised version state, so the bundle needs
 * no new fields and the contract stays as Phase 0 froze it.
 *
 * "Animations" is the number of *distinct* animations, which is how a designer
 * reads the line — the same animation on four elements is one animation, and
 * the same animation pinned to two catalog versions is still one animation
 * with two keyframes blocks behind it.
 *
 * Both counts are over the state the export actually covers: the whole version
 * in full mode, the one selected element in snippet mode.
 */
export function exportStats(state: EditorStateMap | undefined): ExportStats {
  const assignments = Object.values(state ?? {});
  return {
    animations: new Set(assignments.map((assignment) => assignment.animationId)).size,
    elements: assignments.length,
    needsJs: assignments.some((assignment) => assignment.trigger === "in-view"),
  };
}

function count(n: number, noun: string): string {
  return `${n} ${n === 1 ? noun : `${noun}s`}`;
}

/**
 * The handoff's footer line: "2 animations · 4 elements · js not needed (no
 * in-view triggers)" (`docs/design/README.md`, "Export tab").
 */
export function formatExportStats(stats: ExportStats): string {
  const script = stats.needsJs
    ? "includes vibe-motion.js (in-view triggers)"
    : "js not needed (no in-view triggers)";
  return `${count(stats.animations, "animation")} · ${count(stats.elements, "element")} · ${script}`;
}
