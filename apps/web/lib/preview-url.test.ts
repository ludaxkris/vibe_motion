import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const projectId = "11111111-1111-1111-1111-111111111111";
const ORIGINAL_ENV = process.env.NEXT_PUBLIC_API_MOCKING;

describe("previewPageUrl", () => {
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

  it("points at the same-origin mock route when mocking is enabled", async () => {
    process.env.NEXT_PUBLIC_API_MOCKING = "enabled";
    const { previewPageUrl } = await import("./preview-url");

    expect(previewPageUrl(projectId)).toBe(`/mock-api/projects/${projectId}/page`);
  });

  it("points at the real API origin when mocking is disabled", async () => {
    delete process.env.NEXT_PUBLIC_API_MOCKING;
    const { previewPageUrl } = await import("./preview-url");
    const { env } = await import("./env");

    expect(previewPageUrl(projectId)).toBe(`${env.apiOrigin}/projects/${projectId}/page`);
  });
});
