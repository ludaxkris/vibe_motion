import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({ notFound }));

describe("/dev/history", () => {
  beforeEach(() => {
    vi.resetModules();
    notFound.mockClear();
  });

  async function renderPage() {
    vi.doMock("@/lib/env", () => ({ env: { isProduction: false } }));
    const { default: DevHistoryPage } = await import("./page");
    return render(<DevHistoryPage />);
  }

  it("404s in production like the rest of /dev", async () => {
    vi.doMock("@/lib/env", () => ({ env: { isProduction: true } }));
    const { default: DevHistoryPage } = await import("./page");

    expect(() => DevHistoryPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });

  it("renders outside production without calling notFound", async () => {
    await renderPage();

    expect(notFound).not.toHaveBeenCalled();
  });

  it("shows the History list with nothing viewed", async () => {
    await renderPage();

    const frame = screen.getByTestId("dev-frame-history-list");
    expect(within(frame).getByText("Current")).toBeInTheDocument();
    // Nothing is expanded, so no row offers Restore.
    expect(within(frame).queryByRole("button", { name: "Restore" })).not.toBeInTheDocument();
  });

  it("shows the History list with v3 viewed, expanded with its diff and Restore", async () => {
    await renderPage();

    const frame = screen.getByTestId("dev-frame-history-list-viewing");
    expect(within(frame).getByRole("button", { name: "Restore" })).toBeInTheDocument();
    expect(within(frame).getByRole("button", { name: /^Export v3/ })).toBeInTheDocument();
    expect(
      within(frame).getByText(/Restoring creates a new version/),
    ).toBeInTheDocument();
    expect(within(frame).getByText("Removed")).toHaveClass("sr-only");
  });

  it("shows the viewing banner", async () => {
    await renderPage();

    const frame = screen.getByTestId("dev-frame-viewing-banner");
    expect(within(frame).getByText("Viewing v3 · read-only")).toBeInTheDocument();
    expect(within(frame).getByRole("button", { name: "Restore as v5" })).toBeInTheDocument();
    expect(within(frame).getByRole("button", { name: "Back to v4" })).toBeInTheDocument();
  });

  it("shows the conflict dialog's content", async () => {
    await renderPage();

    const frame = screen.getByTestId("dev-frame-conflict-dialog");
    expect(within(frame).getByText("v5 was saved somewhere else")).toBeInTheDocument();
    expect(
      within(frame).getByRole("button", { name: "Apply my changes on top" }),
    ).toBeInTheDocument();
  });
});
