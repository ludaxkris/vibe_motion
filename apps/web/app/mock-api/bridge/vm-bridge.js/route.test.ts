import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_API_MOCKING;

async function get() {
  const { GET } = await import("./route");
  return GET();
}

describe("GET /mock-api/bridge/vm-bridge.js", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.NEXT_PUBLIC_API_MOCKING;
    else process.env.NEXT_PUBLIC_API_MOCKING = ORIGINAL_ENV;
  });

  it("serves the package's own vm-bridge.js, byte for byte", async () => {
    process.env.NEXT_PUBLIC_API_MOCKING = "enabled";
    const expected = await readFile(
      createRequire(import.meta.url).resolve("bridge/vm-bridge.js"),
      "utf8",
    );

    const response = await get();

    expect(response.status).toBe(200);
    expect(await response.text()).toBe(expected);
  });

  it("serves it as JavaScript, so `script-src 'self'` in the frame can run it", async () => {
    process.env.NEXT_PUBLIC_API_MOCKING = "enabled";

    const response = await get();

    expect(response.headers.get("content-type")).toBe("application/javascript; charset=utf-8");
    // The API mixes BRIDGE_VERSION into an ETag; the mock is a dev-only file
    // read per request, so it must never be cached into staleness instead.
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("404s when mocking is off — this route must never exist in a real deployment", async () => {
    delete process.env.NEXT_PUBLIC_API_MOCKING;

    const response = await get();

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("");
  });
});
