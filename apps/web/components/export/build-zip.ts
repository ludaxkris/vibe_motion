import { strToU8, zipSync } from "fflate";

import type { ExportBundle } from "@/lib/api-client";

type ExportFile = ExportBundle["files"][number];

/** The one file the client adds to the zip; the API's bundle never lists it. */
export const README_FILE_NAME = "README.txt";

/** A slug longer than this only makes the download harder to read. */
const MAX_SLUG_LENGTH = 48;

/**
 * Which of the bundle's three text fields a listed file carries.
 *
 * Keyed on `contentType` rather than on the name: the names are the plan's
 * (`index.html` / `vibe-motion.css` / `vibe-motion.js`) but they are data, not
 * a contract this component may assume — the MSW mock still answers with the
 * Phase 0 names until Track C aligns it. The extension is the fallback for a
 * content type this build has not seen.
 */
function kindOf(file: ExportFile): "html" | "css" | "js" | null {
  const type = (file.contentType.split(";")[0] ?? "").trim().toLowerCase();
  if (type === "text/html") return "html";
  if (type === "text/css") return "css";
  if (type === "text/javascript" || type === "application/javascript") return "js";

  const name = file.name.toLowerCase();
  if (name.endsWith(".html") || name.endsWith(".htm")) return "html";
  if (name.endsWith(".css")) return "css";
  if (name.endsWith(".js") || name.endsWith(".mjs")) return "js";
  return null;
}

/** The text of one listed file, or `null` when the bundle carries none for it. */
export function bundleFileText(bundle: ExportBundle, file: ExportFile): string | null {
  switch (kindOf(file)) {
    case "html":
      return bundle.html;
    case "css":
      return bundle.css;
    case "js":
      return bundle.js;
    default:
      return null;
  }
}

/**
 * What goes into the zip: every file the bundle lists that has text, in the
 * order the API listed them, then `README.txt`.
 */
export function zipEntries(
  bundle: ExportBundle,
  readme: string,
): Array<readonly [string, string]> {
  const entries: Array<readonly [string, string]> = [];
  for (const file of bundle.files) {
    const text = bundleFileText(bundle, file);
    if (text !== null) entries.push([file.name, text] as const);
  }
  entries.push([README_FILE_NAME, readme] as const);
  return entries;
}

/** The zip, built in the browser — the API returns text only (plan, owner decision 1). */
export function buildZip(bundle: ExportBundle, readme: string): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  for (const [name, text] of zipEntries(bundle, readme)) {
    // `strToU8` is UTF-8, which is what the CSS header's "·" needs.
    files[name] = strToU8(text);
  }
  return zipSync(files, { level: 6 });
}

/**
 * The project's part of the download name, limited to `[a-z0-9-]` so a title
 * can never put a path separator, a quote or a control character into a file
 * name. Empty after that (an emoji-only title, say) falls back to `project`.
 */
export function slugifyProjectName(value: string | undefined): string {
  const slug = (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    // Truncation can land on the separator; a trailing "-" reads like a typo.
    .replace(/-+$/g, "");
  return slug === "" ? "project" : slug;
}

/** `vibe-motion-<slug>-v<seq>.zip` (plan §1.1). */
export function zipFileName({ slug, versionSeq }: { slug?: string; versionSeq: number }): string {
  return `vibe-motion-${slugifyProjectName(slug)}-v${versionSeq}.zip`;
}
