import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialEditorState, useEditorStore } from "@/lib/store";

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({ notFound }));

/** Every state the gallery has to show, as the screenshot runner will ask for it. */
const FRAMES = [
  "dev-frame-panel-idle-empty",
  "dev-frame-panel-idle-assignments",
  "dev-frame-panel-selected",
  "dev-frame-panel-choosing",
  "dev-frame-panel-choosing-empty-search",
  "dev-frame-panel-tuning-distance",
  "dev-frame-panel-tuning-scale",
  "dev-frame-dialog-unsaved-guard",
  "dev-frame-dialog-save",
  "dev-frame-toast",
  "dev-frame-entry-cloning",
  "dev-frame-entry-error",
] as const;

describe("/dev", () => {
  beforeEach(() => {
    vi.resetModules();
    notFound.mockClear();
    useEditorStore.setState({ ...initialEditorState });
  });

  async function renderGallery() {
    vi.doMock("@/lib/env", () => ({ env: { isProduction: false } }));
    const { default: DevPage } = await import("./page");
    return render(<DevPage />);
  }

  it("renders a labelled frame for every state", async () => {
    await renderGallery();

    for (const id of FRAMES) {
      const frame = screen.getByTestId(id);
      // A frame with no visible label is no use in a screenshot comparison.
      expect(frame.textContent?.trim()).not.toBe("");
    }
    expect(notFound).not.toHaveBeenCalled();
  });

  it("shows each Control Panel state inside its own 320px frame", async () => {
    await renderGallery();

    const panels: [string, string][] = [
      ["dev-frame-panel-idle-empty", "panel-idle"],
      ["dev-frame-panel-idle-assignments", "panel-idle"],
      ["dev-frame-panel-selected", "panel-selected"],
      ["dev-frame-panel-choosing", "panel-choosing"],
      ["dev-frame-panel-choosing-empty-search", "panel-choosing"],
      ["dev-frame-panel-tuning-distance", "panel-tuning"],
      ["dev-frame-panel-tuning-scale", "panel-tuning"],
    ];

    for (const [frameId, panelId] of panels) {
      const frame = screen.getByTestId(frameId);
      expect(within(frame).getByTestId(panelId)).toBeInTheDocument();
      expect(frame.querySelector("[data-dev-frame-body]")).toHaveClass("w-[320px]");
    }
  });

  it("tells the two idle frames apart by whether anything is animated", async () => {
    await renderGallery();

    expect(
      within(screen.getByTestId("dev-frame-panel-idle-empty")).queryByText(/^Animated · /),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("dev-frame-panel-idle-assignments")).getByText("Animated · 2"),
    ).toBeInTheDocument();
  });

  it("shows the two tuning frames on entries with a distance and a scale", async () => {
    await renderGallery();

    const distance = screen.getByTestId("dev-frame-panel-tuning-distance");
    expect(within(distance).getByText("Fade In Up")).toBeInTheDocument();
    expect(distance.querySelector("[data-param='distance']")).not.toBeNull();

    const scale = screen.getByTestId("dev-frame-panel-tuning-scale");
    expect(within(scale).getByText("Pulse")).toBeInTheDocument();
    expect(scale.querySelector("[data-param='scale']")).not.toBeNull();
  });

  it("shows the picker's empty-search copy in its own frame", async () => {
    await renderGallery();

    expect(
      within(screen.getByTestId("dev-frame-panel-choosing-empty-search")).getByText(
        /No animations match/,
      ),
    ).toBeInTheDocument();
  });

  it("stages both dialogs open and inline, on the scrim rather than in a portal", async () => {
    await renderGallery();

    const guard = screen.getByTestId("dev-frame-dialog-unsaved-guard");
    expect(within(guard).getByTestId("unsaved-guard-dialog")).toBeInTheDocument();
    expect(guard.querySelector(".bg-vm-scrim")).not.toBeNull();

    const save = screen.getByTestId("dev-frame-dialog-save");
    expect(within(save).getByTestId("save-dialog")).toBeInTheDocument();
    // Rows come from the real summariser, not from hand-written strings.
    expect(within(save).getByText("Fade In Up")).toBeInTheDocument();
    expect(within(save).getByText("Shake")).toBeInTheDocument();

    // Nothing portalled: no real modal is open over the gallery.
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("shows a standing toast and offers a real one", async () => {
    await renderGallery();

    const frame = screen.getByTestId("dev-frame-toast");
    expect(within(frame).getByText("Saved v6")).toHaveClass("bg-vm-ink", "rounded-pill");
    expect(within(frame).getByRole("button", { name: /Show a toast/ })).toBeInTheDocument();
  });

  it("shows the Entry screen's cloning and error states", async () => {
    await renderGallery();

    const cloning = screen.getByTestId("dev-frame-entry-cloning");
    expect(within(cloning).getByRole("status")).toHaveTextContent("Cloning nimbus.app/pricing");

    const error = screen.getByTestId("dev-frame-entry-error");
    expect(within(error).getByRole("alert")).toHaveTextContent(/sign-in screen/);
    expect(within(error).getByText("Unreachable")).toBeInTheDocument();
  });

  it("never touches the editor store", async () => {
    await renderGallery();

    const { panel, draftState, currentVersionState, mode } = useEditorStore.getState();
    expect({ panel, draftState, currentVersionState, mode }).toEqual(initialEditorState);
  });

  it("calls notFound() in production", async () => {
    vi.doMock("@/lib/env", () => ({ env: { isProduction: true } }));
    const { default: DevPage } = await import("./page");

    expect(() => DevPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });
});
