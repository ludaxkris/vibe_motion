import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({ notFound }));

describe("/dev/panel", () => {
  beforeEach(() => {
    vi.resetModules();
    notFound.mockClear();
  });

  it("renders all four Control Panel states plus a live instance outside production", async () => {
    vi.doMock("@/lib/env", () => ({ env: { isProduction: false } }));
    const { default: DevPanelPage } = await import("./page");

    render(<DevPanelPage />);

    expect(screen.getAllByTestId("panel-idle").length).toBeGreaterThan(0);
    expect(screen.getByTestId("dev-panel-card-selected")).toBeInTheDocument();
    expect(screen.getByTestId("dev-panel-card-choosing")).toBeInTheDocument();
    expect(screen.getByTestId("dev-panel-card-tuning")).toBeInTheDocument();
    expect(screen.getByTestId("dev-panel-live-status")).toHaveTextContent("idle");
    expect(notFound).not.toHaveBeenCalled();
  });

  it("calls notFound() in production", async () => {
    vi.doMock("@/lib/env", () => ({ env: { isProduction: true } }));
    const { default: DevPanelPage } = await import("./page");

    expect(() => DevPanelPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });
});
