import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({ notFound }));

/** Every Export tab state, as the screenshot runner will ask for it. */
const FRAMES = [
  "dev-frame-export-full-js",
  "dev-frame-export-full-no-js",
  "dev-frame-export-snippet",
  "dev-frame-export-pending",
  "dev-frame-export-error",
] as const;

describe("/dev/export", () => {
  beforeEach(() => {
    vi.resetModules();
    notFound.mockClear();
  });

  /**
   * `vi.resetModules()` gives each test its own module registry, so the page
   * graph gets its *own* copy of `@/lib/store` — a copy this file's own import
   * would never see. The store comes back from here, loaded after the render
   * and so from the same registry the page just used.
   */
  async function renderPage() {
    vi.doMock("@/lib/env", () => ({ env: { isProduction: false } }));
    const { default: DevExportPage } = await import("./page");
    const result = render(<DevExportPage />);
    const store = await import("@/lib/store");
    return { ...result, store };
  }

  it("renders a labelled frame for every state", async () => {
    await renderPage();

    for (const id of FRAMES) {
      const frame = screen.getByTestId(id);
      expect(frame.textContent?.trim()).not.toBe("");
    }
    expect(notFound).not.toHaveBeenCalled();
  });

  it("shows each state inside its own 320px frame", async () => {
    await renderPage();

    for (const id of FRAMES) {
      const body = screen.getByTestId(id).querySelector("[data-dev-frame-body]");
      // --panel-width is 320px; the e2e measures it where layout exists.
      expect(body).toHaveClass("w-[var(--panel-width)]");
      expect(within(screen.getByTestId(id)).getByTestId("panel-export")).toBeInTheDocument();
    }
  });

  it("tells the two full-page frames apart by whether the script is needed", async () => {
    await renderPage();

    const withJs = within(screen.getByTestId("dev-frame-export-full-js"));
    expect(withJs.getByTestId("export-stats")).toHaveTextContent(
      "includes vibe-motion.js (in-view triggers)",
    );
    expect(withJs.getByRole("tab", { name: "vibe-motion.js" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );

    const withoutJs = within(screen.getByTestId("dev-frame-export-full-no-js"));
    expect(withoutJs.getByTestId("export-stats")).toHaveTextContent(
      "js not needed (no in-view triggers)",
    );
    expect(withoutJs.getByRole("tab", { name: "vibe-motion.js" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  it("shows the snippet on an older version, with its single file", async () => {
    await renderPage();

    const snippet = within(screen.getByTestId("dev-frame-export-snippet"));
    expect(snippet.getByText("v3")).toBeInTheDocument();
    expect(snippet.queryByText("· current")).not.toBeInTheDocument();
    expect(snippet.getAllByRole("tab")).toHaveLength(1);
    expect(snippet.getByRole("region", { name: "vibe-motion.css" })).toHaveTextContent(
      'add class="vm-a17" to the element',
    );
  });

  it("stages the pending and error states", async () => {
    await renderPage();

    expect(
      within(screen.getByTestId("dev-frame-export-pending")).getByRole("status", {
        name: "Preparing the export",
      }),
    ).toBeInTheDocument();

    const error = within(screen.getByTestId("dev-frame-export-error"));
    expect(error.getByText("No version for this project")).toBeInTheDocument();
    expect(error.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("says why Snippet cannot be chosen when nothing is selected", async () => {
    await renderPage();

    expect(
      within(screen.getByTestId("dev-frame-export-full-no-js")).getByText(
        "Select an animated element on the page to export a snippet.",
      ),
    ).toBeInTheDocument();
  });

  it("never touches the editor store", async () => {
    const { store } = await renderPage();

    const state: Record<string, unknown> = store.useEditorStore.getState();
    const initial: Record<string, unknown> = store.initialEditorState;
    for (const key of Object.keys(initial)) {
      expect(state[key], key).toEqual(initial[key]);
    }
  });

  it("calls notFound() in production", async () => {
    vi.doMock("@/lib/env", () => ({ env: { isProduction: true } }));
    const { default: DevExportPage } = await import("./page");

    expect(() => DevExportPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });
});
