import type { ExportBundle } from "@/lib/api-client";

import { README_FILE_NAME, type ExportFileKind, bundleEntries } from "./build-zip";

/** What each file in the zip is for, in one line. */
function fileNote(kind: ExportFileKind | null, mode: ExportBundle["mode"]): string {
  switch (kind) {
    case "html":
      return "your page, with a vm-a… class on every animated element";
    case "js":
      return "the in-view trigger; link it from <head>, not deferred";
    case "css":
      return mode === "snippet"
        ? "the keyframes and rules for the selected element"
        : "the animations";
    default:
      return "part of this export";
  }
}

/** A two-column list whose descriptions line up however long the names are. */
function fileList(rows: ReadonlyArray<readonly [string, string]>): string {
  const width = Math.max(...rows.map(([name]) => name.length)) + 2;
  return rows.map(([name, note]) => `  ${name.padEnd(width)}${note}`).join("\n");
}

/**
 * Numbers a list of steps, each of which is already broken into lines, so a
 * step that does not apply can be left out without leaving a gap in the count.
 */
function numbered(steps: ReadonlyArray<readonly string[]>): string[] {
  return steps.flatMap((lines, index) =>
    lines.map((line, position) => (position === 0 ? `${index + 1}. ${line}` : `   ${line}`)),
  );
}

/**
 * `README.txt`, the one file the client adds to the zip.
 *
 * Written from `bundleEntries`, so it names exactly the files the zip holds,
 * under exactly those names. Every step is conditional on the file it talks
 * about actually being there: a bundle missing a part must produce a shorter
 * README, never one that says "Serve undefined in place of your current page".
 *
 * It names no project and no URL: like the CSS header (plan §1.4), nothing
 * identifying reaches an export.
 */
export function buildReadme(
  bundle: ExportBundle,
  { versionLabel }: { versionLabel: string },
): string {
  const snippet = bundle.mode === "snippet";
  const entries = bundleEntries(bundle);

  const rows: Array<readonly [string, string]> = entries.map(
    (entry) => [entry.name, fileNote(entry.kind, bundle.mode)] as const,
  );
  rows.push([README_FILE_NAME, "this file"] as const);

  const nameOf = (kind: ExportFileKind) => entries.find((entry) => entry.kind === kind)?.name;
  const htmlName = nameOf("html");
  const cssName = nameOf("css");
  const jsName = nameOf("js");

  const steps: string[][] = [];
  if (snippet) {
    if (cssName) {
      steps.push([
        `Add ${cssName} to your site, or paste its contents into a stylesheet`,
        "you already load.",
      ]);
      steps.push([
        "Add the vm-a… class named in the comment at the top of that file",
        "to the element you want to animate.",
      ]);
    }
    if (jsName) {
      steps.push([
        `Add <script src="${jsName}"></script> to <head>, and the class`,
        "vm-in-view to the same element. The animation is held on its",
        "first frame until the element scrolls into view.",
      ]);
    }
  } else {
    const together = [htmlName, cssName, jsName].filter((name) => name !== undefined);
    if (together.length > 1) {
      steps.push([
        `Put ${together.join(", ")} in the same`,
        "folder on your site, next to each other.",
      ]);
    }
    if (htmlName) {
      const linked = [cssName, jsName].filter((name) => name !== undefined);
      steps.push([
        `Serve ${htmlName} in place of your current page.`,
        ...(linked.length > 0 ? [`It already links ${linked.join(" and ")} from <head>.`] : []),
      ]);
      steps.push([
        "Prefer to keep your own markup? Copy the <link> (and <script>) tags",
        `from the <head> of ${htmlName}, and the vm-a… classes from its`,
        "animated elements, onto your page instead.",
      ]);
    } else if (cssName) {
      steps.push([
        `Link ${cssName} from your page's <head>, and add the vm-a… classes`,
        "it names to the matching elements.",
      ]);
    }
  }

  return [
    "Vibe Motion export",
    "==================",
    "",
    `Version:  ${versionLabel}`,
    `Mode:     ${snippet ? "snippet (one element)" : "full page"}`,
    "",
    "Files",
    "-----",
    fileList(rows),
    "",
    "How to use",
    "----------",
    ...numbered(steps),
    "",
    "Notes",
    "-----",
    "  - Every class, keyframe and custom property is prefixed vm- or --vm-,",
    "    so nothing here can collide with your own styles.",
    "  - The rules sit inside @media (prefers-reduced-motion: no-preference):",
    "    a reader who asks for less motion sees the page untouched.",
    "  - No !important anywhere. Re-export after any change; this file is a",
    "    snapshot of one saved version.",
    "",
  ].join("\n");
}
