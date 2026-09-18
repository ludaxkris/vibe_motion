import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { pageFixtureHtml } from "./page";

describe("pageFixtureHtml", () => {
  it("matches page.html byte-for-byte, so the two never drift apart", () => {
    const onDisk = readFileSync(path.join(import.meta.dirname, "page.html"), "utf-8");
    expect(pageFixtureHtml).toBe(onDisk);
  });

  it("tags every element with data-vm-id", () => {
    expect(pageFixtureHtml).toContain('data-vm-id="vm-heading"');
    expect(pageFixtureHtml).toContain('data-vm-id="vm-paragraph"');
    expect(pageFixtureHtml).toContain('data-vm-id="vm-image"');
    expect(pageFixtureHtml).toContain('data-vm-id="vm-button"');
    expect(pageFixtureHtml).toContain('data-vm-id="vm-card"');
  });
});
