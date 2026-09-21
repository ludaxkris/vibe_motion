import { describe, expect, it } from "vitest";

import type { ExportBundle } from "@/lib/api-client";

import { README_FILE_NAME } from "./build-zip";
import { buildReadme } from "./readme";

function bundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    versionId: "11111111-1111-4111-8111-111111111111",
    mode: "full",
    html: "<!doctype html>",
    css: ".vm-a17 {}",
    js: null,
    files: [
      { name: "index.html", contentType: "text/html" },
      { name: "vibe-motion.css", contentType: "text/css" },
    ],
    ...overrides,
  };
}

describe("buildReadme", () => {
  it("names every file the zip actually holds, README included", () => {
    const readme = buildReadme(bundle(), { versionLabel: "v5" });

    expect(readme).toContain("index.html");
    expect(readme).toContain("vibe-motion.css");
    expect(readme).toContain(README_FILE_NAME);
    // The js file is not in this zip, so it must not be described as if it were.
    expect(readme).not.toContain("vibe-motion.js");
  });

  it("describes the in-view script when the bundle carries one", () => {
    const readme = buildReadme(
      bundle({
        js: "(function(){})();",
        files: [
          { name: "index.html", contentType: "text/html" },
          { name: "vibe-motion.css", contentType: "text/css" },
          { name: "vibe-motion.js", contentType: "text/javascript" },
        ],
      }),
      { versionLabel: "v5" },
    );

    expect(readme).toContain("vibe-motion.js");
    expect(readme).toMatch(/in-view/i);
  });

  it("says which version it came from", () => {
    expect(buildReadme(bundle(), { versionLabel: "v12" })).toContain("v12");
  });

  it("tells a snippet reader to paste the class, not to replace the page", () => {
    const snippet = buildReadme(
      bundle({
        mode: "snippet",
        html: null,
        css: '/* add class="vm-a17" to the element */',
        files: [{ name: "vibe-motion.css", contentType: "text/css" }],
      }),
      { versionLabel: "v5" },
    );

    expect(snippet).toMatch(/snippet/i);
    expect(snippet).toContain("vm-a");
    expect(snippet).not.toContain("index.html");
  });

  it("records the two promises the exported CSS makes", () => {
    const readme = buildReadme(bundle(), { versionLabel: "v5" });

    expect(readme).toContain("prefers-reduced-motion");
    expect(readme).toContain("vm-");
  });

  it("never prints `undefined` for a file the bundle did not list", () => {
    // Contract-impossible, and the one shape that used to produce
    // "Serve undefined in place of your current page".
    const readme = buildReadme(
      bundle({ html: null, files: [{ name: "vibe-motion.css", contentType: "text/css" }] }),
      { versionLabel: "v5" },
    );

    expect(readme).not.toContain("undefined");
    expect(readme).not.toContain("index.html");
    expect(readme).toContain("vibe-motion.css");
  });

  it("names a file the API carried but forgot to list, under the plan's name", () => {
    const readme = buildReadme(
      bundle({ js: "(function(){})();" }),
      { versionLabel: "v5" },
    );

    expect(readme).toContain("vibe-motion.js");
    expect(readme).not.toContain("undefined");
  });

  it("numbers its steps from one with no gaps, whatever is missing", () => {
    for (const each of [
      bundle(),
      bundle({ html: null, files: [{ name: "vibe-motion.css", contentType: "text/css" }] }),
      bundle({
        mode: "snippet",
        html: null,
        css: '/* add class="vm-a17" to the element */',
        files: [{ name: "vibe-motion.css", contentType: "text/css" }],
      }),
    ]) {
      const steps = buildReadme(each, { versionLabel: "v5" })
        .split("\n")
        .filter((line) => /^\d+\. /.test(line))
        .map((line) => Number.parseInt(line, 10));
      expect(steps.length).toBeGreaterThan(0);
      expect(steps).toEqual(steps.map((_, index) => index + 1));
    }
  });

  it("is deterministic and ends in exactly one newline", () => {
    const first = buildReadme(bundle(), { versionLabel: "v5" });
    const second = buildReadme(bundle(), { versionLabel: "v5" });

    expect(first).toBe(second);
    expect(first.endsWith("\n")).toBe(true);
    expect(first.endsWith("\n\n")).toBe(false);
    expect(first).not.toContain("\r");
  });
});
