import type { ExportBundle } from "@/lib/api-client";

import { README_FILE_NAME, bundleFileText } from "./build-zip";

type ExportFile = ExportBundle["files"][number];

/**
 * What each file in the zip is for, in one line. Keyed on what the bundle
 * carries rather than on the name, for the reason `bundleFileText` gives.
 */
function fileNote(bundle: ExportBundle, file: ExportFile): string {
  const text = bundleFileText(bundle, file);
  if (text === bundle.html) return "your page, with a vm-a… class on every animated element";
  if (text === bundle.js) return "the in-view trigger; link it from <head>, not deferred";
  return bundle.mode === "snippet"
    ? "the keyframes and rules for the selected element"
    : "the animations";
}

/** A two-column list whose descriptions line up however long the names are. */
function fileList(rows: ReadonlyArray<readonly [string, string]>): string {
  const width = Math.max(...rows.map(([name]) => name.length)) + 2;
  return rows.map(([name, note]) => `  ${name.padEnd(width)}${note}`).join("\n");
}

/**
 * `README.txt`, the one file the client adds to the zip.
 *
 * Written from the bundle, so a file name the API changes flows through here
 * instead of going stale. It names no project and no URL: like the CSS header
 * (plan §1.4), nothing identifying reaches an export.
 */
export function buildReadme(
  bundle: ExportBundle,
  { versionLabel }: { versionLabel: string },
): string {
  const snippet = bundle.mode === "snippet";
  const rows: Array<readonly [string, string]> = bundle.files
    .filter((file) => bundleFileText(bundle, file) !== null)
    .map((file) => [file.name, fileNote(bundle, file)] as const);
  rows.push([README_FILE_NAME, "this file"] as const);

  const cssName = bundle.files.find((file) => bundleFileText(bundle, file) === bundle.css)?.name;
  const htmlName = bundle.files.find((file) => bundleFileText(bundle, file) === bundle.html)?.name;
  const jsName =
    bundle.js === null
      ? undefined
      : bundle.files.find((file) => bundleFileText(bundle, file) === bundle.js)?.name;

  const steps = snippet
    ? [
        `1. Add ${cssName} to your site, or paste its contents into a stylesheet`,
        "   you already load.",
        "2. Add the vm-a… class named in the comment at the top of that file",
        "   to the element you want to animate.",
        ...(jsName
          ? [
              `3. Add <script src="${jsName}"></script> to <head>, and the class`,
              "   vm-in-view to the same element. The animation is held on its",
              "   first frame until the element scrolls into view.",
            ]
          : []),
      ]
    : [
        `1. Put ${[htmlName, cssName, jsName].filter(Boolean).join(", ")} in the same`,
        "   folder on your site, next to each other.",
        `2. Serve ${htmlName} in place of your current page. It already links`,
        `   ${[cssName, jsName].filter(Boolean).join(" and ")} from <head>.`,
        "3. Prefer to keep your own markup? Copy the <link> (and <script>) tags",
        `   from the <head> of ${htmlName}, and the vm-a… classes from its`,
        "   animated elements, onto your page instead.",
      ];

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
    ...steps,
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
