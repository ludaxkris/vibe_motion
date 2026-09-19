import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = process.env.NEXT_PUBLIC_API_MOCKING;
const projectId = "11111111-1111-1111-1111-111111111111";

/**
 * `NextRequest` rewrites a `127.0.0.1` authority in `request.url` to
 * `localhost`, so the `Host` header is the only faithful record of which
 * loopback name the browser asked for — which is exactly what the route reads.
 */
async function get(host = "127.0.0.1:3000") {
  const { GET } = await import("./route");
  return GET(
    new NextRequest(`http://${host}/mock-api/projects/${projectId}/page`, { headers: { host } }),
  );
}

describe("GET /mock-api/projects/[projectId]/page", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.NEXT_PUBLIC_API_MOCKING;
    else process.env.NEXT_PUBLIC_API_MOCKING = ORIGINAL_ENV;
  });

  it("injects the bridge script tag, pointed at the shell's own loopback host", async () => {
    process.env.NEXT_PUBLIC_API_MOCKING = "enabled";

    const html = await (await get()).text();

    // The frame is on 127.0.0.1, so the shell is on localhost: the parent
    // origin the bridge checks every inbound message against.
    expect(html).toContain(
      '<script src="/mock-api/bridge/vm-bridge.js" data-vm-parent-origin="http://localhost:3000" defer></script>',
    );
  });

  it("swaps the other way when the frame is the one on localhost", async () => {
    process.env.NEXT_PUBLIC_API_MOCKING = "enabled";

    const html = await (await get("localhost:4711")).text();

    expect(html).toContain('data-vm-parent-origin="http://127.0.0.1:4711"');
  });

  it("keeps the fixture markup and puts the script after it", async () => {
    process.env.NEXT_PUBLIC_API_MOCKING = "enabled";
    const { pageFixtureHtml } = await import("@/mocks/fixtures/page");

    const html = await (await get()).text();

    expect(html).toContain('data-vm-id="vm-heading"');
    expect(html.indexOf("vm-bridge.js")).toBeGreaterThan(html.indexOf('data-vm-id="vm-button"'));
    expect(html.length).toBeGreaterThan(pageFixtureHtml.length);
  });

  it("sends the API's page policy plus frame-ancestors for the shell", async () => {
    process.env.NEXT_PUBLIC_API_MOCKING = "enabled";
    const { BASE_POLICY } = await import("@/mocks/page-csp");

    const response = await get();

    expect(response.headers.get("content-security-policy")).toBe(
      `${BASE_POLICY}; frame-ancestors http://localhost:3000`,
    );
    // `script-src 'self'` is what makes the injected tag the only script that
    // can run in the frame; a fixture copy that dropped it would let anything
    // the clone carries execute.
    expect(BASE_POLICY).toContain("script-src 'self'");
    expect(BASE_POLICY).toContain("connect-src 'none'");
  });

  it("uses the same base policy string the API's BridgePageRenderer sends", async () => {
    // Two policies that are meant to be identical are two policies that can
    // drift; the mock exists precisely so an e2e run exercises the real one.
    const here = path.dirname(fileURLToPath(import.meta.url));
    const kotlin = await readFile(
      path.resolve(
        here,
        "../../../../../../api/src/main/kotlin/dev/vibemotion/api/clone/BridgePageRenderer.kt",
      ),
      "utf8",
    );
    const { BASE_POLICY } = await import("@/mocks/page-csp");

    // The Kotlin constant is a multi-line concatenation of string literals.
    const declaration = kotlin.slice(kotlin.indexOf("private const val BASE_POLICY"));
    const fromKotlin = [...declaration.slice(0, declaration.indexOf("\n\n")).matchAll(/"([^"]*)"/g)]
      .map((match) => match[1])
      .join("");

    expect(fromKotlin).not.toBe("");
    expect(BASE_POLICY).toBe(fromKotlin);
  });

  it("404s when mocking is off", async () => {
    delete process.env.NEXT_PUBLIC_API_MOCKING;

    const response = await get();

    expect(response.status).toBe(404);
    expect(response.headers.get("content-security-policy")).toBeNull();
  });
});
