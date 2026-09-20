import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const notFound = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("next/navigation", () => ({ notFound }));

/** Every state the gallery has to show, as the screenshot runner will ask for it. */
const FRAMES = [
  "dev-frame-panel-idle-empty",
  "dev-frame-panel-idle-assignments",
  "dev-frame-panel-idle-generating",
  "dev-frame-panel-idle-error",
  "dev-frame-panel-selected",
  "dev-frame-panel-choosing",
  "dev-frame-panel-choosing-empty-search",
  "dev-frame-panel-tuning-distance",
  "dev-frame-panel-tuning-scale",
  "dev-frame-panel-tuning-selects",
  "dev-frame-panel-tuning-from-auto",
  "dev-frame-panel-auto-result",
  "dev-frame-dialog-unsaved-guard",
  "dev-frame-dialog-unsaved-guard-many",
  "dev-frame-dialog-save",
  "dev-frame-toast",
  "dev-frame-entry-cloning",
  "dev-frame-entry-error",
] as const;

describe("/dev", () => {
  beforeEach(() => {
    vi.resetModules();
    notFound.mockClear();
    // `doMock` registrations outlive `resetModules`, so the one test that
    // takes an entry out of the catalog does not get to keep it out.
    vi.doUnmock("@/lib/catalog");
  });

  /**
   * `vi.resetModules()` gives each test its own module registry, so the page
   * graph gets its *own* copy of `@/lib/store` — a copy this file's own import
   * would never see. The store comes back from here, loaded after the render
   * and so from the same registry the gallery just used.
   */
  async function renderGallery() {
    vi.doMock("@/lib/env", () => ({ env: { isProduction: false } }));
    const { default: DevPage } = await import("./page");
    const result = render(<DevPage />);
    const store = await import("@/lib/store");
    return { ...result, store };
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

  it("shows the ‹ control only on the tuning frame opened from the result list", async () => {
    await renderGallery();

    const fromAuto = screen.getByTestId("dev-frame-panel-tuning-from-auto");
    expect(within(fromAuto).getByRole("button", { name: "Back" })).toBeInTheDocument();

    const plain = screen.getByTestId("dev-frame-panel-tuning-distance");
    expect(within(plain).queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
  });

  it("takes the result list's names and timings straight from the catalog", async () => {
    await renderGallery();
    const { getCatalogEntry, resolveCatalogParams } = await import("@/lib/catalog");

    const entry = getCatalogEntry("fade-in-up");
    if (!entry) throw new Error("fade-in-up has left the catalog");
    const params = resolveCatalogParams(entry);

    const rows = within(screen.getByTestId("dev-frame-panel-auto-result")).getAllByTestId(
      "auto-result-row",
    );
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent(entry.name);
    expect(rows[0]).toHaveTextContent(`load · ${params.duration} · ${params.delay}`);
    // Exactly one row has been tuned by hand since the run.
    expect(rows.filter((row) => within(row).queryByText("edited"))).toHaveLength(1);
  });

  it("shows each Control Panel state inside its own 320px frame", async () => {
    await renderGallery();

    const panels: [string, string][] = [
      ["dev-frame-panel-idle-empty", "panel-idle"],
      ["dev-frame-panel-idle-assignments", "panel-idle"],
      ["dev-frame-panel-idle-generating", "panel-idle"],
      ["dev-frame-panel-idle-error", "panel-idle"],
      ["dev-frame-panel-selected", "panel-selected"],
      ["dev-frame-panel-choosing", "panel-choosing"],
      ["dev-frame-panel-choosing-empty-search", "panel-choosing"],
      ["dev-frame-panel-tuning-distance", "panel-tuning"],
      ["dev-frame-panel-tuning-scale", "panel-tuning"],
      ["dev-frame-panel-tuning-selects", "panel-tuning"],
      ["dev-frame-panel-tuning-from-auto", "panel-tuning"],
      ["dev-frame-panel-auto-result", "panel-auto-result"],
    ];

    for (const [frameId, panelId] of panels) {
      const frame = screen.getByTestId(frameId);
      expect(within(frame).getByTestId(panelId)).toBeInTheDocument();
      // --panel-width is 320px; the e2e measures it where layout exists.
      expect(frame.querySelector("[data-dev-frame-body]")).toHaveClass(
        "w-[var(--panel-width)]",
      );
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

  it("shows the select rows a long CSS keyword forces, on an entry with direction", async () => {
    await renderGallery();

    const selects = screen.getByTestId("dev-frame-panel-tuning-selects");
    expect(within(selects).getByText("Spin")).toBeInTheDocument();
    expect(within(selects).getByRole("combobox", { name: "Direction" })).toHaveTextContent(
      "normal",
    );
    expect(within(selects).getByRole("combobox", { name: "Fill mode" })).toHaveTextContent(
      "none",
    );
    // Nothing on this row is clipped to fit any more.
    expect(selects.querySelector("[data-param='direction'] .truncate")).toBeNull();
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

  it("shows the guard's other half: the question it asks for several elements", async () => {
    await renderGallery();

    const many = screen.getByTestId("dev-frame-dialog-unsaved-guard-many");
    expect(within(many).getByText("Save changes?")).toBeInTheDocument();
    expect(within(many).getByText(/You have unsaved changes on 2 elements\./)).toBeInTheDocument();
  });

  it("takes the Save dialog's meta straight from the catalog", async () => {
    await renderGallery();

    // fade-in-up at its catalog defaults is the handoff's own example string.
    expect(
      within(screen.getByTestId("dev-frame-dialog-save")).getByText("600ms · ease-out · 24px"),
    ).toBeInTheDocument();
  });

  it("never stages a live-looking Save that cannot save", async () => {
    await renderGallery();

    for (const [frame, name] of [
      ["dev-frame-dialog-unsaved-guard", "Save"],
      ["dev-frame-dialog-save", "Save version"],
    ] as const) {
      expect(within(screen.getByTestId(frame)).getByRole("button", { name })).toBeDisabled();
    }
  });

  it("survives an animation the catalog no longer has, rather than failing the build", async () => {
    // A module-scope `throw` here would take the whole production build down
    // with it — `next build` renders this route to decide it is a 404.
    vi.doMock("@/lib/env", () => ({ env: { isProduction: false } }));
    vi.doMock("@/lib/catalog", async () => {
      const actual = await vi.importActual<typeof import("@/lib/catalog")>("@/lib/catalog");
      return {
        ...actual,
        getCatalogEntry: (id: string) => (id === "pulse" ? undefined : actual.getCatalogEntry(id)),
      };
    });
    const { default: DevPage } = await import("./page");

    expect(() => render(<DevPage />)).not.toThrow();

    const scale = screen.getByTestId("dev-frame-panel-tuning-scale");
    expect(within(scale).getByText(/pulse is not in catalog/)).toBeInTheDocument();
    // Everything that does not depend on the missing entry still renders.
    expect(
      within(screen.getByTestId("dev-frame-panel-tuning-distance")).getByText("Fade In Up"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("dev-frame-dialog-save")).toBeInTheDocument();
  });

  it("links to the History tab's own page, which it is too tall to inline", async () => {
    await renderGallery();

    expect(screen.getByRole("link", { name: "/dev/history" })).toHaveAttribute(
      "href",
      "/dev/history",
    );
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
    const { store } = await renderGallery();

    // Key by key off `initialEditorState` rather than a hand-written subset of
    // it, so a new field in the store cannot quietly drop out of this check.
    const state: Record<string, unknown> = store.useEditorStore.getState();
    const initial: Record<string, unknown> = store.initialEditorState;
    for (const key of Object.keys(initial)) {
      expect(state[key], key).toEqual(initial[key]);
    }
  });

  it("calls notFound() in production", async () => {
    vi.doMock("@/lib/env", () => ({ env: { isProduction: true } }));
    const { default: DevPage } = await import("./page");

    expect(() => DevPage()).toThrow("NEXT_NOT_FOUND");
    expect(notFound).toHaveBeenCalledOnce();
  });
});
