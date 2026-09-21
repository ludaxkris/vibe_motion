import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";

import type { ExportBundle } from "@/lib/api-client";

import {
  README_FILE_NAME,
  buildZip,
  bundleEntries,
  bundleFileText,
  safeZipEntryName,
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
  it("routes each listed file to the bundle field its content type names", async () => {
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

  it("keeps text the API carried but forgot to list, under the plan's own name", () => {
    // Contract-impossible if the exporter is right; losing it would leave the
    // CSS holding every in-view element paused with nothing to release it.
    const bundle = fullBundle({
      js: "(function(){})();",
      files: [
        { name: "index.html", contentType: "text/html" },
        { name: "vibe-motion.css", contentType: "text/css" },
      ],
    });

    expect(zipEntries(bundle, "r").map(([name]) => name)).toEqual([
      "index.html",
      "vibe-motion.css",
      "vibe-motion.js",
      README_FILE_NAME,
    ]);
    expect(zipEntries(bundle, "r")[2][1]).toBe(bundle.js);
  });

  it("keeps an unlisted stylesheet and page too", () => {
    const bundle = fullBundle({ files: [] });

    expect(zipEntries(bundle, "r").map(([name]) => name)).toEqual([
      "index.html",
      "vibe-motion.css",
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

describe("safeZipEntryName", () => {
  it("is a file in the archive, never a path", () => {
    expect(safeZipEntryName("../../etc/passwd")).toBe("passwd");
    expect(safeZipEntryName("a/b/c.css")).toBe("c.css");
    expect(safeZipEntryName("..\\..\\windows\\system32")).toBe("system32");
    expect(safeZipEntryName("..")).toBe("file");
    expect(safeZipEntryName("/")).toBe("file");
  });

  it("never starts on a dot, and carries no control characters", () => {
    expect(safeZipEntryName(".hidden.css")).toBe("hidden.css");
    expect(safeZipEntryName("in\u0000dex.html")).toBe("index.html");
  });

  it("does not let a name run away with the archive", () => {
    expect(safeZipEntryName(`${"a".repeat(300)}.css`).length).toBe(100);
  });
});

describe("bundleEntries", () => {
  it("gives every entry a distinct name", () => {
    const bundle = fullBundleWithJs();
    bundle.files = [
      { name: "vibe-motion.css", contentType: "text/html" },
      { name: "vibe-motion.css", contentType: "text/css" },
      { name: "../vibe-motion.css", contentType: "text/javascript" },
    ];

    expect(bundleEntries(bundle).map((entry) => entry.name)).toEqual([
      "vibe-motion.css",
      "vibe-motion-2.css",
      "vibe-motion-3.css",
    ]);
  });

  it("keeps the kind and the text of each entry", () => {
    const bundle = fullBundleWithJs();

    expect(bundleEntries(bundle)).toEqual([
      { name: "index.html", kind: "html", text: bundle.html },
      { name: "vibe-motion.css", kind: "css", text: bundle.css },
      { name: "vibe-motion.js", kind: "js", text: bundle.js },
    ]);
  });
});

describe("buildZip", () => {
  it("round-trips through fflate to exactly the bundle's files plus README.txt", async () => {
    const bundle = fullBundleWithJs();

    const unzipped = unzipSync(await buildZip(bundle, "how to use these files"));

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

  it("carries a snippet's single file", async () => {
    const bundle = snippetBundle();

    const unzipped = unzipSync(await buildZip(bundle, "r"));

    expect(Object.keys(unzipped)).toEqual(["vibe-motion.css", README_FILE_NAME]);
    expect(strFromU8(unzipped["vibe-motion.css"])).toBe(bundle.css);
  });

  it("never puts a path, or two files under one name, into the archive", async () => {
    const bundle = fullBundleWithJs();
    bundle.files = [
      { name: "../../etc/index.html", contentType: "text/html" },
      { name: "styles.css", contentType: "text/css" },
      { name: "styles.css", contentType: "text/javascript" },
    ];

    const unzipped = unzipSync(await buildZip(bundle, "r"));

    expect(Object.keys(unzipped)).toEqual([
      "index.html",
      "styles.css",
      "styles-2.css",
      README_FILE_NAME,
    ]);
    // Nothing was collapsed: the js is still there, under its own name, and
    // the suffix lands before the extension so the file still opens.
    expect(strFromU8(unzipped["styles-2.css"])).toBe(bundle.js);
  });

  it("is asynchronous: the encoder is loaded, and runs, off the hot path", async () => {
    // A 10 MB export (DT-175) compressed on the main thread would freeze the
    // editor and its preview iframe. The promise is the contract the panel's
    // busy state hangs off.
    const pending = buildZip(fullBundle(), "r");
    expect(pending).toBeInstanceOf(Promise);
    expect(Object.keys(unzipSync(await pending))).toContain(README_FILE_NAME);
  });

  it("survives text outside the Latin-1 range", async () => {
    const bundle = fullBundle({ css: "/* Vibe Motion · v5 · caté */" });

    const unzipped = unzipSync(await buildZip(bundle, "r"));

    expect(strFromU8(unzipped["vibe-motion.css"])).toBe("/* Vibe Motion · v5 · caté */");
  });
});

describe("slugifyProjectName", () => {
  it("keeps only [a-z0-9-]", () => {
    expect(slugifyProjectName("Nimbus App — Pricing!")).toBe("nimbus-app-pricing");
    expect(slugifyProjectName("MiXeD  CaSe")).toBe("mixed-case");
  });

  it("drops a URL scheme rather than spelling it out in the download name", () => {
    expect(slugifyProjectName("https://nimbus.app/pricing")).toBe("nimbus-app-pricing");
    expect(slugifyProjectName("HTTP://Nimbus.app")).toBe("nimbus-app");
    // Only a real scheme, and only at the front.
    expect(slugifyProjectName("see https://nimbus.app")).toBe("see-https-nimbus-app");
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
