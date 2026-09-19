import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectId = "11111111-1111-1111-1111-111111111111";
const ORIGINAL_ENV = process.env.NEXT_PUBLIC_API_MOCKING;

/** A `Location`-shaped stand-in, so a case can put the shell on either loopback host. */
const at = (origin: string) => {
  const url = new URL(origin);
  return { protocol: url.protocol, hostname: url.hostname, port: url.port, href: url.href };
};

describe("previewPageUrl / previewOrigin", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) {
      delete process.env.NEXT_PUBLIC_API_MOCKING;
    } else {
      process.env.NEXT_PUBLIC_API_MOCKING = ORIGINAL_ENV;
    }
  });

  it("frames the mock page on the *other* loopback host, so the mock is genuinely cross-origin", async () => {
    process.env.NEXT_PUBLIC_API_MOCKING = "enabled";
    const { previewPageUrl, previewOrigin } = await import("./preview-url");

    expect(previewPageUrl(projectId, at("http://localhost:3000"))).toBe(
      `http://127.0.0.1:3000/mock-api/projects/${projectId}/page`,
    );
    expect(previewOrigin(projectId, at("http://localhost:3000"))).toBe("http://127.0.0.1:3000");
  });

  it("swaps the other way when the shell itself was opened on 127.0.0.1", async () => {
    process.env.NEXT_PUBLIC_API_MOCKING = "enabled";
    const { previewPageUrl, previewOrigin } = await import("./preview-url");

    expect(previewPageUrl(projectId, at("http://127.0.0.1:3000"))).toBe(
      `http://localhost:3000/mock-api/projects/${projectId}/page`,
    );
    expect(previewOrigin(projectId, at("http://127.0.0.1:3000"))).toBe("http://localhost:3000");
  });

  it("uses the port the dev server actually got", async () => {
    process.env.NEXT_PUBLIC_API_MOCKING = "enabled";
    const { previewOrigin } = await import("./preview-url");

    expect(previewOrigin(projectId, at("http://localhost:4711"))).toBe("http://127.0.0.1:4711");
  });

  it("falls back to the same origin when the shell is on a host with no loopback sibling", async () => {
    process.env.NEXT_PUBLIC_API_MOCKING = "enabled";
    const { previewPageUrl, previewOrigin } = await import("./preview-url");

    expect(previewPageUrl(projectId, at("http://web:3000"))).toBe(
      `/mock-api/projects/${projectId}/page`,
    );
    expect(previewOrigin(projectId, at("http://web:3000"))).toBe("http://web:3000");
  });

  it("points at the real API origin when mocking is disabled, whatever the shell's host", async () => {
    delete process.env.NEXT_PUBLIC_API_MOCKING;
    const { previewPageUrl, previewOrigin } = await import("./preview-url");
    const { env } = await import("./env");

    expect(previewPageUrl(projectId, at("http://localhost:3000"))).toBe(
      `${env.apiOrigin}/projects/${projectId}/page`,
    );
    expect(previewOrigin(projectId, at("http://localhost:3000"))).toBe(env.apiOrigin);
  });

  it("reads the live location by default", async () => {
    process.env.NEXT_PUBLIC_API_MOCKING = "enabled";
    const { previewOrigin } = await import("./preview-url");

    // jsdom serves the tests from http://localhost:3000.
    expect(previewOrigin(projectId)).toBe("http://127.0.0.1:3000");
  });

  it("knows when the frame would share the shell's origin", async () => {
    process.env.NEXT_PUBLIC_API_MOCKING = "enabled";
    const { previewIsSameOrigin } = await import("./preview-url");

    // Loopback siblings: genuinely cross-origin.
    expect(previewIsSameOrigin(projectId, at("http://localhost:3000"))).toBe(false);
    // No sibling to swap to, so the frame lands on this very origin.
    expect(previewIsSameOrigin(projectId, at("http://192.168.1.9:3000"))).toBe(true);
    expect(previewIsSameOrigin(projectId, at("http://web:3000"))).toBe(true);
  });

  it("is never same-origin against a real API on another host", async () => {
    delete process.env.NEXT_PUBLIC_API_MOCKING;
    const { previewIsSameOrigin } = await import("./preview-url");

    expect(previewIsSameOrigin(projectId, at("http://localhost:3000"))).toBe(false);
  });

  it("flags a real deployment that serves the API under the web origin", async () => {
    delete process.env.NEXT_PUBLIC_API_MOCKING;
    process.env.NEXT_PUBLIC_API_ORIGIN = "https://app.example.test";
    try {
      const { previewIsSameOrigin } = await import("./preview-url");
      expect(previewIsSameOrigin(projectId, at("https://app.example.test"))).toBe(true);
    } finally {
      delete process.env.NEXT_PUBLIC_API_ORIGIN;
    }
  });

  it("has no frame origin to check against while rendering on the server", async () => {
    process.env.NEXT_PUBLIC_API_MOCKING = "enabled";
    const { previewPageUrl, previewOrigin } = await import("./preview-url");

    // Mock mode never reaches the browser through SSR (`MockProvider` renders
    // nothing until the worker starts), but the helpers still have to be safe
    // to call without a `window`.
    expect(previewPageUrl(projectId, null)).toBe(`/mock-api/projects/${projectId}/page`);
    expect(previewOrigin(projectId, null)).toBe("");
  });
});
