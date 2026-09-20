import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import type { ExportBundle } from "@/lib/api-client";

import {
  README_FILE_NAME,
  buildZip,
  bundleFileText,
  slugifyProjectName,
  zipEntries,
  zipFileName,
} from "./build-zip";

/** A full-page bundle with the names the exporter really uses (plan §1.1). */
function fullBundle(overrides: Partial<ExportBundle> = {}): ExportBundle {
  return {
    versionId: "11111111-1111-4111-8111-111111111111",
    mode: "full",
    html: "<!doctype html><html><head></head><body><h1 class=\"vm-a17\">Hi</h1></body></html>",
    css: ".vm-a17 { animation: vm-fade-in-up-v1-1-0 600ms ease-out 0ms 1 normal both; }",
    js: null,
    files: [
      { name: "index.html", contentType: "text/html" },
      { name: "vibe-motion.css", contentType: "text/css" },
    ],
    ...overrides,
  };
}

function fullBundleWithJs(): ExportBundle {
  return fullBundle({
    js: "(function(){document.documentElement.classList.add('vm-js')})();",
    files: [
      { name: "index.html", contentType: "text/html" },
      { name: "vibe-motion.css", contentType: "text/css" },
      { name: "vibe-motion.js", contentType: "text/javascript" },
    ],
  });
}

function snippetBundle(): ExportBundle {
  return {
    versionId: "11111111-1111-4111-8111-111111111111",
    mode: "snippet",
    html: null,
    css: "/* add class=\"vm-a17\" to the element */\n.vm-a17 { animation: none; }",
    js: null,
    files: [{ name: "vibe-motion.css", contentType: "text/css" }],
  };
}

describe("bundleFileText", () => {
  it("routes each listed file to the bundle field its content type names", () => {
    const bundle = fullBundleWithJs();

    expect(bundleFileText(bundle, bundle.files[0])).toBe(bundle.html);
    expect(bundleFileText(bundle, bundle.files[1])).toBe(bundle.css);
    expect(bundleFileText(bundle, bundle.files[2])).toBe(bundle.js);
  });

  it("falls back to the extension when the content type is one this build has not seen", () => {
    const bundle = fullBundleWithJs();

    expect(
      bundleFileText(bundle, { name: "vibe-motion.js", contentType: "application/x-unknown" }),
    ).toBe(bundle.js);
  });

  it("is null for a file the bundle carries no text for", () => {
    const bundle = fullBundle();

    // Full mode with no in-view trigger: `js` is null, so the tab has nothing.
    expect(bundleFileText(bundle, { name: "vibe-motion.js", contentType: "text/javascript" })).toBeNull();
    expect(bundleFileText(bundle, { name: "notes.md", contentType: "text/markdown" })).toBeNull();
  });
});

describe("zipEntries", () => {
  it("takes its names, and their order, from bundle.files and adds README.txt last", () => {
    const bundle = fullBundleWithJs();

    expect(zipEntries(bundle, "readme text").map(([name]) => name)).toEqual([
      "index.html",
      "vibe-motion.css",
      "vibe-motion.js",
      README_FILE_NAME,
    ]);
  });

  it("leaves out a listed file the bundle has no text for", () => {
    const bundle = fullBundle({
      files: [
        { name: "index.html", contentType: "text/html" },
        { name: "vibe-motion.css", contentType: "text/css" },
        { name: "vibe-motion.js", contentType: "text/javascript" },
      ],
    });

    expect(zipEntries(bundle, "r").map(([name]) => name)).toEqual([
      "index.html",
      "vibe-motion.css",
      README_FILE_NAME,
    ]);
  });
});

describe("buildZip", () => {
  it("round-trips through fflate to exactly the bundle's files plus README.txt", () => {
    const bundle = fullBundleWithJs();

    const unzipped = unzipSync(buildZip(bundle, "how to use these files"));

    expect(Object.keys(unzipped)).toEqual([
      "index.html",
      "vibe-motion.css",
      "vibe-motion.js",
      README_FILE_NAME,
    ]);
    expect(strFromU8(unzipped["index.html"])).toBe(bundle.html);
    expect(strFromU8(unzipped["vibe-motion.css"])).toBe(bundle.css);
    expect(strFromU8(unzipped["vibe-motion.js"])).toBe(bundle.js);
    expect(strFromU8(unzipped[README_FILE_NAME])).toBe("how to use these files");
  });

  it("carries a snippet's single file", () => {
    const bundle = snippetBundle();

    const unzipped = unzipSync(buildZip(bundle, "r"));

    expect(Object.keys(unzipped)).toEqual(["vibe-motion.css", README_FILE_NAME]);
    expect(strFromU8(unzipped["vibe-motion.css"])).toBe(bundle.css);
  });

  it("survives text outside the Latin-1 range", () => {
    const bundle = fullBundle({ css: "/* Vibe Motion · v5 · caté */" });

    const unzipped = unzipSync(buildZip(bundle, "r"));

    expect(strFromU8(unzipped["vibe-motion.css"])).toBe("/* Vibe Motion · v5 · caté */");
  });
});

describe("slugifyProjectName", () => {
  it("keeps only [a-z0-9-]", () => {
    expect(slugifyProjectName("Nimbus App — Pricing!")).toBe("nimbus-app-pricing");
    expect(slugifyProjectName("https://nimbus.app/pricing")).toBe("https-nimbus-app-pricing");
    expect(slugifyProjectName("MiXeD  CaSe")).toBe("mixed-case");
  });

  it("falls back to `project` when nothing usable is left", () => {
    expect(slugifyProjectName(undefined)).toBe("project");
    expect(slugifyProjectName("")).toBe("project");
    expect(slugifyProjectName("   ")).toBe("project");
    expect(slugifyProjectName("—–—")).toBe("project");
  });

  it("does not let a long title run away with the file name", () => {
    expect(slugifyProjectName("a".repeat(200))).toBe("a".repeat(48));
    // Never ends on the separator the truncation could land on.
    expect(slugifyProjectName(`${"a".repeat(47)} bcd`)).toBe("a".repeat(47));
  });
});

describe("zipFileName", () => {
  it("is vibe-motion-<slug>-v<seq>.zip", () => {
    expect(zipFileName({ slug: "Nimbus App", versionSeq: 5 })).toBe("vibe-motion-nimbus-app-v5.zip");
    expect(zipFileName({ versionSeq: 12 })).toBe("vibe-motion-project-v12.zip");
  });

  it("only ever contains characters that are safe in a file name", () => {
    const name = zipFileName({ slug: "../../etc/passwd", versionSeq: 1 });

    expect(name).toBe("vibe-motion-etc-passwd-v1.zip");
    expect(name).toMatch(/^[a-z0-9.-]+$/);
  });
});
