/** What the Export tab's footer line counts. */
export type ExportStats = {
  /** Distinct animations used, however many elements each is on. */
  animations: number;
  /** Elements carrying an assignment. */
  elements: number;
  /** Whether some assignment uses `in-view`, which is what needs the script. */
  needsJs: boolean;
};

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
