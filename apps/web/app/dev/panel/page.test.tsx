import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
const redirect = vi.fn((url: string) => {
  throw new Error(`NEXT_REDIRECT:${url}`);
});

vi.mock("next/navigation", () => ({ notFound, redirect }));

describe("/dev/panel", () => {
  beforeEach(() => {
    vi.resetModules();
    notFound.mockClear();
    redirect.mockClear();
  });

  it("sends the old Control Panel gallery to /dev", async () => {
    vi.doMock("@/lib/env", () => ({ env: { isProduction: false } }));
    const { default: DevPanelPage } = await import("./page");

    expect(() => DevPanelPage()).toThrow("NEXT_REDIRECT:/dev");
    expect(redirect).toHaveBeenCalledWith("/dev");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("404s in production like the rest of /dev", async () => {
    vi.doMock("@/lib/env", () => ({ env: { isProduction: true } }));
    const { default: DevPanelPage } = await import("./page");

    expect(() => DevPanelPage()).toThrow("NEXT_NOT_FOUND");
    expect(redirect).not.toHaveBeenCalled();
  });
});
