import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { VersionHistory } from "@/components/history/use-version-history";
import type { Version } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION, defaultAssignmentFor, getCatalogEntry } from "@/lib/catalog";
import { env } from "@/lib/env";
import { initialEditorState, useEditorStore } from "@/lib/store";
import { server } from "@/mocks/server";

import { ControlPanel } from "./index";

beforeEach(() => {
  useEditorStore.setState({ ...initialEditorState });
});

describe("ControlPanel", () => {
  it("renders the idle panel when nothing is selected", () => {
    render(<ControlPanel />);
    expect(screen.getByTestId("panel-idle")).toBeInTheDocument();
  });

  it("renders the selected panel once an element is selected", () => {
    useEditorStore.getState().dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    render(<ControlPanel />);
    expect(screen.getByTestId("panel-selected")).toBeInTheDocument();
  });

  it("renders the choosing panel", () => {
    useEditorStore.getState().dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    render(<ControlPanel />);
    expect(screen.getByTestId("panel-choosing")).toBeInTheDocument();
  });

  it("renders the tuning panel", () => {
    useEditorStore.getState().dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });
    render(<ControlPanel />);
    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();
  });

  it("wires the idle panel's rows to the selection, landing on tuning", () => {
    useEditorStore.getState().dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });
    useEditorStore.getState().dispatchPanel({ type: "DESELECT" });
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("button", { name: /Fade In on vm-1/ }));

    expect(useEditorStore.getState().panel).toEqual({
      status: "tuning",
      vmId: "vm-1",
      animationId: "fade-in",
    });
  });

  it("Change then ‹ comes back to tuning, not to 'No animation yet'", () => {
    const store = useEditorStore.getState();
    store.dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.dispatchPanel({ type: "PICK", animationId: "fade-in" });
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    expect(screen.getByTestId("panel-choosing")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();
    expect(screen.queryByText(/No animation yet/)).not.toBeInTheDocument();
  });

  it("Change dispatches CHANGE, so BACK stays free to mean 'up one level'", () => {
    const store = useEditorStore.getState();
    store.dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.dispatchPanel({ type: "PICK", animationId: "fade-in" });
    // As if the element had been opened from the result list: BACK from here
    // would land on `auto`, CHANGE must land on the picker.
    store.dispatchPanel({ type: "AUTO_DONE" });
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Change" }));

    expect(useEditorStore.getState().panel).toEqual({
      status: "choosing",
      vmId: "vm-1",
      returnTo: "auto",
    });
  });

  it("tuning and selected show ‹ only when opened from the result list", () => {
    const store = useEditorStore.getState();
    store.dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    const { unmount } = render(<ControlPanel />);
    expect(screen.queryByRole("button", { name: "Back" })).not.toBeInTheDocument();
    unmount();

    store.dispatchPanel({ type: "AUTO_DONE" });
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(useEditorStore.getState().panel).toEqual({ status: "auto" });
    expect(screen.getByTestId("panel-auto-result")).toBeInTheDocument();
  });

  it("‹ on a tuning panel opened from the result list returns to the list", () => {
    const store = useEditorStore.getState();
    store.dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.dispatchPanel({ type: "PICK", animationId: "fade-in" });
    store.dispatchPanel({ type: "AUTO_DONE" });
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(useEditorStore.getState().panel).toEqual({ status: "auto" });
  });

  it("renders the result list in the auto state, and ‹ closes it to idle", () => {
    useEditorStore.getState().dispatchPanel({ type: "AUTO_DONE" });
    render(<ControlPanel />);

    expect(screen.getByTestId("panel-auto-result")).toBeInTheDocument();
    // Until Track B wires them, no control may look live and do nothing.
    expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Back" }));

    expect(useEditorStore.getState().panel).toEqual({ status: "idle" });
  });

  it("re-picking the card already applied keeps what was tuned", () => {
    const store = useEditorStore.getState();
    store.dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.dispatchPanel({ type: "PICK", animationId: "fade-in" });
    store.updateDraftParam("vm-1", "duration", "900ms");
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Change" }));
    fireEvent.click(screen.getByRole("button", { name: "Fade In" }));

    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();
    expect(useEditorStore.getState().draftState["vm-1"].params.duration).toBe("900ms");
  });

  it("carries the handoff's three folder tabs, Animate first", () => {
    render(<ControlPanel />);

    expect(screen.getByRole("tab", { name: "Animate" })).toHaveAttribute("data-active");
    expect(screen.getByRole("tab", { name: "History" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Export" })).toBeInTheDocument();
  });

  it("gives History and Export a caption each when no project is behind the panel", () => {
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    expect(screen.getByText(/only created when you click Save/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Export" }));
    expect(screen.getByText(/built from a saved version/i)).toBeInTheDocument();
  });

  it("keeps the caption pointing at the top bar for Save and Cancel", () => {
    render(<ControlPanel />);

    expect(screen.getByText(/Save and Cancel live in the top bar/)).toBeInTheDocument();
  });
});

describe("ControlPanel · pinned catalog version", () => {
  /** A draft assignment on `vm-1` pinned to `catalogVersion`, mid-tuning. */
  function tuningPinnedTo(catalogVersion: string, animationId = "fade-in") {
    useEditorStore.setState({
      panel: { status: "tuning", vmId: "vm-1", animationId },
      draftState: {
        "vm-1": {
          animationId,
          catalogVersion,
          trigger: "load",
          params: { duration: "600ms", delay: "0ms", easing: "ease-out" },
        },
      },
    });
  }

  it("tunes a 1.0.0 assignment against 1.0.0, which has no fill mode", () => {
    tuningPinnedTo("1.0.0");
    render(<ControlPanel />);

    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();
    expect(screen.getByText("Duration")).toBeInTheDocument();
    // `fillMode` arrived in 1.1.0; offering it here would write a param the
    // pinned version cannot validate.
    expect(screen.queryByText("Fill mode")).not.toBeInTheDocument();
  });

  it("tunes a current-version assignment against the current catalog", () => {
    tuningPinnedTo(CURRENT_CATALOG_VERSION);
    render(<ControlPanel />);

    expect(screen.getByText("Fill mode")).toBeInTheDocument();
  });

  it("says so when the pinned version has no such entry", () => {
    tuningPinnedTo("9.9.9");
    render(<ControlPanel />);

    expect(screen.getByTestId("panel-tuning-missing-entry")).toBeInTheDocument();
  });

  it("names the guarded animation from the version the assignment pinned", () => {
    useEditorStore.setState({
      panel: { status: "tuning", vmId: "vm-1", animationId: "fade-in" },
      draftState: {
        "vm-1": {
          animationId: "fade-in",
          catalogVersion: "9.9.9",
          trigger: "load",
          params: {},
        },
      },
    });
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    const dialog = screen.getByRole("dialog", { name: "Save changes to vm-1?" });
    // No 9.9.9 catalog to name it from, so the id stands in — rather than the
    // current catalog's name for an entry this assignment never used.
    expect(within(dialog).getByText("fade-in")).toBeInTheDocument();
  });
});

describe("ControlPanel · unsaved guard", () => {
  /** Puts a draft assignment on `vm-1` that the saved version does not have. */
  function makeDirty() {
    const store = useEditorStore.getState();
    store.dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.dispatchPanel({ type: "PICK", animationId: "fade-in-up" });
  }

  it("keeps the inactive folder tabs faint while there are unsaved changes", () => {
    makeDirty();
    render(<ControlPanel />);

    expect(screen.getByRole("tab", { name: "History" })).toHaveClass("text-vm-ink-4");
    expect(screen.getByRole("tab", { name: "Animate" })).not.toHaveClass("text-vm-ink-4");
  });

  it("leaves the tabs alone while the draft is clean", () => {
    render(<ControlPanel />);

    expect(screen.getByRole("tab", { name: "History" })).not.toHaveClass("text-vm-ink-4");
  });

  it("asks before leaving the tab, naming the element and its animation", () => {
    makeDirty();
    render(<ControlPanel currentVersionLabel="v5" />);

    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    const dialog = screen.getByRole("dialog", { name: "Save changes to vm-1?" });
    expect(within(dialog).getByText("Fade In Up")).toBeInTheDocument();
    expect(within(dialog).getByText(/discard to leave v5 as is/)).toBeInTheDocument();
    // The switch has not happened: Animate's body is still the one behind the
    // modal. (By role it is unreachable — the open dialog inerts the page —
    // so this asks the DOM rather than the accessibility tree.)
    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();
  });

  it("names the element only when a discard would take nothing else with it", () => {
    makeDirty();
    render(<ControlPanel currentVersionLabel="v5" />);

    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    const dialog = screen.getByRole("dialog", { name: "Save changes to vm-1?" });
    expect(within(dialog).getByText("Fade In Up")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(useEditorStore.getState().draftState).toEqual({});
  });

  it("counts the elements instead of naming one when two have unsaved changes", () => {
    // The reviewer's repro: animate vm-1, then animate vm-2 and leave vm-2
    // selected. "Save changes to vm-2?" would point at one of the two things
    // Discard is about to throw away.
    makeDirty();
    const store = useEditorStore.getState();
    store.setSelectedVmId("vm-2");
    store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.dispatchPanel({ type: "PICK", animationId: "pulse" });
    render(<ControlPanel currentVersionLabel="v5" />);

    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    const dialog = screen.getByRole("dialog", { name: "Save changes?" });
    expect(
      within(dialog).getByText(/You have unsaved changes on 2 elements\./),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText("Pulse")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    // Both of them, which is exactly what the copy said.
    expect(useEditorStore.getState().draftState).toEqual({});
  });

  it("asks generically when the unsaved work is on some other element", () => {
    makeDirty();
    // The selection moves to an element that is exactly as it was saved
    // (namely: with nothing on it). Naming it would be a lie.
    useEditorStore.getState().setSelectedVmId("vm-2");
    render(<ControlPanel currentVersionLabel="v5" />);

    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    const dialog = screen.getByRole("dialog", { name: "Save changes?" });
    expect(within(dialog).getByText(/You have unsaved changes/)).toBeInTheDocument();
    expect(within(dialog).queryByText("Fade In Up")).not.toBeInTheDocument();
  });

  it("guards the Export tab too", () => {
    makeDirty();
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("tab", { name: "Export" }));

    expect(screen.getByRole("dialog", { name: "Save changes to vm-1?" })).toBeInTheDocument();
    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(screen.getByRole("tab", { name: "Export" })).toHaveAttribute("data-active");
    expect(screen.getByText(/built from a saved version/i)).toBeInTheDocument();
  });

  it("discards the draft and then makes the switch", () => {
    makeDirty();
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    fireEvent.click(screen.getByRole("button", { name: "Discard" }));

    expect(useEditorStore.getState().draftState).toEqual({});
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("data-active");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("keeps the edit and the tab on Keep editing", () => {
    makeDirty();
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    expect(useEditorStore.getState().draftState["vm-1"]).toBeDefined();
    expect(screen.getByRole("tab", { name: "Animate" })).toHaveAttribute("data-active");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("never offers a save it cannot perform", () => {
    makeDirty();
    render(<ControlPanel />);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    expect(screen.getByText("Saving isn’t available here.")).toBeInTheDocument();
  });

  it("makes the switch once the save flow says a version was written", async () => {
    makeDirty();
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<ControlPanel onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    const save = within(screen.getByRole("dialog")).getByRole("button", { name: "Save" });
    expect(save).toBeEnabled();
    expect(screen.queryByText("Saving isn’t available here.")).not.toBeInTheDocument();

    fireEvent.click(save);

    await waitFor(() =>
      expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("data-active"),
    );
    expect(onSave).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    // Unlike Discard, the draft is the version now: nothing was reverted.
    expect(useEditorStore.getState().draftState["vm-1"]).toBeDefined();
  });

  it("keeps the guard standing when the save does not happen", async () => {
    makeDirty();
    // What `requestSave()` rejects with when the Save dialog is cancelled.
    const onSave = vi.fn().mockRejectedValue(new Error("save cancelled"));
    render(<ControlPanel onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));

    await waitFor(() => expect(onSave).toHaveBeenCalled());
    expect(screen.getByRole("dialog", { name: "Save changes to vm-1?" })).toBeInTheDocument();
    // The switch has not happened: Animate's body is still the one behind the
    // modal. (By role the tabs are unreachable — the open dialog inerts the
    // page — so this asks the DOM rather than the accessibility tree.)
    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();
  });

  it("lets the pending tab through when the draft goes clean without a version of its own", async () => {
    makeDirty();
    // What the 409's "Discard my changes" leaves behind: their version is
    // loaded, so the draft is clean — and the promise still rejects, because
    // nothing of *mine* was written. The guard would otherwise stay open
    // claiming unsaved changes, with a Save that could do nothing at all.
    const onSave = vi.fn().mockRejectedValue(new Error("save cancelled"));
    render(<ControlPanel onSave={onSave} />);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    fireEvent.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalled());

    act(() => {
      useEditorStore.getState().loadVersion("their-version", {});
    });

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("tab", { name: "History" })).toHaveAttribute("data-active");
  });

  it("switches straight away once the draft is clean again", () => {
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("tab", { name: "Export" }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Export" })).toHaveAttribute("data-active");
  });
});

describe("ControlPanel bridge seams", () => {
  function choosing() {
    useEditorStore.getState().dispatchPanel({ type: "SELECT", vmId: "vm-1" });
    useEditorStore.getState().dispatchPanel({ type: "CHOOSE_CUSTOM" });
  }

  it("previews exactly what picking the hovered card would apply", () => {
    const onPreview = vi.fn();
    const onClearPreview = vi.fn();
    choosing();
    render(<ControlPanel onPreview={onPreview} onClearPreview={onClearPreview} />);

    const card = screen.getByRole("button", { name: "Fade In Up" });
    fireEvent.mouseEnter(card);

    expect(onPreview).toHaveBeenCalledWith("vm-1", {
      animationId: "fade-in-up",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: "load",
      params: expect.objectContaining({ duration: expect.any(String) }),
    });
    // …and it stays a preview: the draft is untouched (CLAUDE.md rule 9).
    expect(useEditorStore.getState().draftState).toEqual({});

    fireEvent.mouseLeave(card);
    expect(onClearPreview).toHaveBeenCalledOnce();
  });

  it("ends the preview when the picker goes away, whatever took it away", () => {
    const onClearPreview = vi.fn();
    choosing();
    const view = render(<ControlPanel onPreview={vi.fn()} onClearPreview={onClearPreview} />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Fade In Up" }));
    // A pick unmounts the grid under the pointer, so the card never gets its
    // `mouseleave` — and a preview left behind would sit on top of every
    // later apply (spec D6).
    fireEvent.click(screen.getByRole("button", { name: "Fade In Up" }));

    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();
    expect(onClearPreview).toHaveBeenCalled();

    onClearPreview.mockClear();
    view.unmount();
  });

  it("ends the preview when the element is deselected out from under the picker", () => {
    const onClearPreview = vi.fn();
    choosing();
    render(<ControlPanel onPreview={vi.fn()} onClearPreview={onClearPreview} />);
    fireEvent.mouseEnter(screen.getByRole("button", { name: "Fade In Up" }));

    act(() => {
      useEditorStore.getState().dispatchPanel({ type: "DESELECT" });
    });

    expect(onClearPreview).toHaveBeenCalled();
  });

  it("previews the element's own tuned assignment for the card already applied", () => {
    const onPreview = vi.fn();
    choosing();
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in-up" });
    act(() => {
      useEditorStore.getState().updateDraftParam("vm-1", "duration", "1200ms");
    });
    // Back into the picker with that animation applied and tuned.
    act(() => {
      useEditorStore.getState().dispatchPanel({ type: "BACK" });
    });
    render(<ControlPanel onPreview={onPreview} onClearPreview={vi.fn()} />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Fade In Up" }));

    // Clicking that card keeps the tuned value (the store's PICK says so), so
    // hovering it must not snap the element back to the catalog default.
    expect(onPreview).toHaveBeenCalledWith(
      "vm-1",
      expect.objectContaining({ params: expect.objectContaining({ duration: "1200ms" }) }),
    );
  });

  it("previews catalog defaults for a card that is not the applied one", () => {
    const onPreview = vi.fn();
    choosing();
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in-up" });
    act(() => {
      useEditorStore.getState().updateDraftParam("vm-1", "duration", "1200ms");
      useEditorStore.getState().dispatchPanel({ type: "BACK" });
    });
    render(<ControlPanel onPreview={onPreview} onClearPreview={vi.fn()} />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Pulse" }));

    // The catalog's own defaults for `pulse`, not the tuned `fade-in-up` ones.
    expect(onPreview).toHaveBeenCalledWith("vm-1", defaultAssignmentFor(getCatalogEntry("pulse")!));
  });

  it("leaves the picker inert when there is no bridge to preview on", () => {
    choosing();
    render(<ControlPanel />);

    fireEvent.mouseEnter(screen.getByRole("button", { name: "Fade In Up" }));

    expect(useEditorStore.getState().draftState).toEqual({});
  });

  it("replays the element being tuned, and again when a slider is released", () => {
    const onReplay = vi.fn();
    choosing();
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });
    render(<ControlPanel onReplay={onReplay} />);

    fireEvent.click(screen.getByRole("button", { name: "Replay" }));
    expect(onReplay).toHaveBeenCalledWith("vm-1");

    const slider = screen.getByLabelText("Duration");
    slider.focus();
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    fireEvent.keyUp(slider, { key: "ArrowRight" });

    expect(onReplay).toHaveBeenCalledTimes(2);
    expect(useEditorStore.getState().draftState["vm-1"]?.params.duration).toBe("650ms");
  });

  it("keeps Replay disabled while no bridge is mounted", () => {
    choosing();
    useEditorStore.getState().dispatchPanel({ type: "PICK", animationId: "fade-in" });
    render(<ControlPanel />);

    expect(screen.getByRole("button", { name: "Replay" })).toBeDisabled();
  });
});

describe("ControlPanel · History and viewing", () => {
  /** What the shell's `useVersionHistory` hands down, in the state a test needs. */
  function historyStub(overrides: Partial<VersionHistory> = {}): VersionHistory {
    return {
      versions: [],
      pending: false,
      listError: false,
      retry: () => undefined,
      currentVersionId: "current-id",
      viewingVersionId: null,
      viewing: false,
      viewingLabel: undefined,
      currentLabel: "v5",
      nextLabel: "v6",
      error: null,
      restoring: false,
      view: async () => undefined,
      back: () => undefined,
      restore: async () => undefined,
      ...overrides,
    };
  }

  it("mounts the History tab once the shell hands it a project's history", () => {
    render(<ControlPanel history={historyStub()} />);

    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    expect(screen.getByTestId("panel-history")).toBeInTheDocument();
    expect(screen.queryByText(/only created when you click Save/i)).not.toBeInTheDocument();
  });

  it("keeps the placeholder when there is no project behind the panel", () => {
    render(<ControlPanel />);

    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    expect(screen.queryByTestId("panel-history")).not.toBeInTheDocument();
    expect(screen.getByText(/only created when you click Save/i)).toBeInTheDocument();
  });

  it("makes Animate read-only while a past version is on screen, and says why", () => {
    useEditorStore.setState({ mode: "viewing", viewingVersionId: "viewed-id" });
    render(
      <ControlPanel
        history={historyStub({ viewing: true, viewingVersionId: "viewed-id", viewingLabel: "v3" })}
      />,
    );

    expect(screen.getByText("Viewing v3 — read-only. Go back to v5 to edit.")).toBeInTheDocument();
    // The store already refuses every draft write while viewing; this is the
    // half the reader can see — no control that looks live and does nothing.
    expect(screen.getByRole("tabpanel")).toHaveAttribute("inert");
  });

  it("leaves Animate alone while editing", () => {
    render(<ControlPanel history={historyStub()} />);

    expect(screen.getByRole("tabpanel")).not.toHaveAttribute("inert");
    expect(screen.queryByText(/read-only/)).not.toBeInTheDocument();
  });

  it("cancels a version still loading when the reader leaves the History tab", () => {
    const back = vi.fn();
    render(<ControlPanel history={historyStub({ back })} />);
    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    // Nothing is on screen yet — a row was clicked and its `/state` is still
    // in flight — and `back()` is what cancels it (the hook drops the answer),
    // so it is called on the way out whether or not viewing has begun.
    fireEvent.click(screen.getByRole("tab", { name: "Export" }));

    expect(back).toHaveBeenCalledOnce();
  });

  it("comes back to the current version when the reader leaves the History tab", () => {
    const back = vi.fn();
    useEditorStore.setState({ mode: "viewing", viewingVersionId: "viewed-id" });
    render(
      <ControlPanel
        history={historyStub({
          viewing: true,
          viewingVersionId: "viewed-id",
          viewingLabel: "v3",
          back,
        })}
      />,
    );
    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    fireEvent.click(screen.getByRole("tab", { name: "Animate" }));

    // The editor must never sit in viewing mode with the History tab closed.
    expect(back).toHaveBeenCalledOnce();
    expect(screen.getByRole("tab", { name: "Animate" })).toHaveAttribute("data-active");
  });
});

describe("ControlPanel · agent flows (Phase 5)", () => {
  function info(vmId: string, tag: string, order: number) {
    return {
      vmId,
      tag,
      role: null,
      textPreview: `${tag} text`,
      rect: { x: 0, y: 0, width: 300, height: 80 },
      pageRect: { x: 0, y: 0, width: 300, height: 80 },
      order,
      visible: true,
    };
  }

  function assignmentFor(animationId: string) {
    return defaultAssignmentFor(getCatalogEntry(animationId)!);
  }

  /** A page run that assigned a `p` (listed first by the agent) and the `h1` above it. */
  function seedRun(overrides: { truncated?: boolean; prompt?: string } = {}) {
    const store = useEditorStore.getState();
    store.rememberElements([info("vm-h1", "h1", 0), info("vm-p", "p", 5)]);
    store.applyPageSuggestion({
      suggestion: {
        assignments: { "vm-p": assignmentFor("fade-in"), "vm-h1": assignmentFor("fade-in-up") },
        skipped: [{ vmId: "vm-x", reason: "too-small" }],
      },
      seed: 1,
      prompt: overrides.prompt ?? "calm entrances",
      truncated: overrides.truncated ?? false,
      viewport: { width: 1200, height: 600 },
    });
  }

  const ok = () => Promise.resolve({ ok: true as const, count: 1 });

  describe("idle", () => {
    it("binds the prompt to the store", () => {
      render(<ControlPanel />);

      fireEvent.change(screen.getByLabelText("Describe the feel"), { target: { value: "bouncy" } });

      expect(useEditorStore.getState().prompt).toBe("bouncy");
      expect(screen.getByLabelText("Describe the feel")).toHaveValue("bouncy");
    });

    it("keeps auto-generate and Replay all disabled with no bridge", () => {
      useEditorStore.getState().setDraftAssignment("vm-1", assignmentFor("fade-in"));
      render(<ControlPanel />);

      expect(screen.getByRole("button", { name: "Auto-generate for this page" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Replay all" })).toBeDisabled();
    });

    it("runs a page auto-generate once on a double click, busy meanwhile", async () => {
      let finish!: (outcome: { ok: true; count: number }) => void;
      const onAutoGeneratePage = vi.fn(
        () => new Promise<{ ok: true; count: number }>((resolve) => (finish = resolve)),
      );
      render(<ControlPanel onAutoGeneratePage={onAutoGeneratePage} />);

      const button = screen.getByRole("button", { name: "Auto-generate for this page" });
      fireEvent.click(button);
      fireEvent.click(button);

      expect(onAutoGeneratePage).toHaveBeenCalledExactlyOnceWith();
      expect(screen.getByRole("button", { name: "Generating…" })).toBeDisabled();

      await act(async () => finish({ ok: true, count: 2 }));
      expect(screen.getByRole("button", { name: "Auto-generate for this page" })).toBeEnabled();
    });

    it.each([
      ["query-failed", "Couldn't read the page. Try again."],
      ["no-targets", "Nothing on this page looks worth animating."],
    ] as const)("shows the %s message, and clears it on the next run", async (reason, copy) => {
      const onAutoGeneratePage = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, reason })
        .mockImplementation(() => new Promise(() => undefined));
      render(<ControlPanel onAutoGeneratePage={onAutoGeneratePage} />);

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Auto-generate for this page" }));
      });
      expect(screen.getByRole("status")).toHaveTextContent(copy);

      fireEvent.click(screen.getByRole("button", { name: "Auto-generate for this page" }));
      expect(screen.queryByTestId("agent-run-error")).not.toBeInTheDocument();
      expect(screen.getByRole("status")).toHaveTextContent("Generating…");
    });

    it("does not carry a page failure over to another panel", async () => {
      const onAutoGeneratePage = vi.fn().mockResolvedValue({ ok: false, reason: "no-targets" });
      render(<ControlPanel onAutoGeneratePage={onAutoGeneratePage} onGenerateElement={ok} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Auto-generate for this page" }));
      });

      act(() => useEditorStore.getState().setSelectedVmId("vm-1"));

      expect(screen.getByTestId("panel-selected")).toBeInTheDocument();
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });

    it("replays the whole page from the idle list", () => {
      const onReplay = vi.fn();
      useEditorStore.getState().setDraftAssignment("vm-1", assignmentFor("fade-in"));
      render(<ControlPanel onReplay={onReplay} />);

      fireEvent.click(screen.getByRole("button", { name: "Replay all" }));

      expect(onReplay).toHaveBeenCalledExactlyOnceWith(null);
    });
  });

  describe("selected", () => {
    it("shows the element's text and generates for that element", async () => {
      const onGenerateElement = vi.fn(ok);
      useEditorStore.getState().rememberElement(info("vm-h1", "h1", 0));
      useEditorStore.getState().setSelectedVmId("vm-h1");
      render(<ControlPanel onGenerateElement={onGenerateElement} />);

      expect(screen.getByText("h1 text")).toBeInTheDocument();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Auto-generate for this element" }));
      });

      expect(onGenerateElement).toHaveBeenCalledExactlyOnceWith("vm-h1");
    });

    it("keeps the button disabled with no bridge, and shows a failure under it", async () => {
      useEditorStore.getState().setSelectedVmId("vm-h1");
      const { rerender } = render(<ControlPanel />);
      expect(screen.getByRole("button", { name: "Auto-generate for this element" })).toBeDisabled();

      rerender(
        <ControlPanel onGenerateElement={() => Promise.resolve({ ok: false, reason: "agent-failed" })} />,
      );
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Auto-generate for this element" }));
      });

      expect(screen.getByRole("status")).toHaveTextContent("Couldn't read the page. Try again.");
    });
  });

  describe("the result list", () => {
    it("lists the last run in document order, by tag and pinned animation name", () => {
      seedRun();
      render(<ControlPanel />);

      const rows = screen.getAllByTestId("auto-result-row");
      expect(rows.map((row) => row.getAttribute("aria-label"))).toEqual([
        "Tune Fade In Up on h1 (vm-h1)",
        "Tune Fade In on p (vm-p)",
      ]);
      expect(screen.getByTestId("auto-result-title")).toHaveTextContent("Generated 2 animations");
      expect(screen.getByTestId("auto-result-prompt")).toHaveTextContent("calm entrances");
      expect(screen.getByTestId("auto-result-caption")).toHaveTextContent("Skipped 1 element");
      expect(within(rows[0]).queryByText("edited")).not.toBeInTheDocument();
    });

    it("quotes the query limit when the listing was truncated", () => {
      seedRun({ truncated: true });
      render(<ControlPanel />);

      expect(screen.getByTestId("auto-result-caption")).toHaveTextContent(
        "Only the first 200 elements were considered.",
      );
    });

    it("falls back to a generic tag, listed last, for an element the bridge never described", () => {
      seedRun();
      useEditorStore.getState().applyPageSuggestion({
        suggestion: { assignments: { "vm-ghost": assignmentFor("pulse") }, skipped: [] },
        seed: 2,
        prompt: "",
        truncated: false,
        viewport: { width: 1200, height: 600 },
      });
      render(<ControlPanel />);

      const labels = screen.getAllByTestId("auto-result-row").map((row) => row.getAttribute("aria-label"));
      expect(labels[labels.length - 1]).toBe("Tune Pulse on element (vm-ghost)");
    });

    it("tags a hand-tuned row as edited and keeps it listed", () => {
      seedRun();
      useEditorStore.getState().updateDraftParam("vm-h1", "duration", "1250ms");
      render(<ControlPanel />);

      const [h1, p] = screen.getAllByTestId("auto-result-row");
      expect(within(h1).getByText("edited")).toBeInTheDocument();
      expect(within(p).queryByText("edited")).not.toBeInTheDocument();
    });

    it("a row click goes through requestSelect and lands on tuning with a way back", () => {
      seedRun();
      const real = useEditorStore.getState().requestSelect;
      const requestSelect = vi.fn(real);
      useEditorStore.setState({ requestSelect });
      render(<ControlPanel />);

      fireEvent.click(screen.getByRole("button", { name: "Tune Fade In on p (vm-p)" }));
      useEditorStore.setState({ requestSelect: real });

      // Through the guard's front door (Task 0 result item 9), not around it.
      expect(requestSelect).toHaveBeenCalledWith("vm-p");
      expect(useEditorStore.getState().panel).toEqual({
        status: "tuning",
        vmId: "vm-p",
        animationId: "fade-in",
        returnTo: "auto",
      });
    });

    it("Regenerate re-runs the page with regenerate: true, disabled while busy", async () => {
      let finish!: (outcome: { ok: true; count: number }) => void;
      const onAutoGeneratePage = vi.fn(
        () => new Promise<{ ok: true; count: number }>((resolve) => (finish = resolve)),
      );
      seedRun();
      render(<ControlPanel onAutoGeneratePage={onAutoGeneratePage} />);

      fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

      expect(onAutoGeneratePage).toHaveBeenCalledExactlyOnceWith({ regenerate: true });
      expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled();
      await act(async () => finish({ ok: true, count: 2 }));
      expect(screen.getByRole("button", { name: "Regenerate" })).toBeEnabled();
    });

    it("Remove all cannot race a run in flight: disabled while busy, and says so", async () => {
      let finish!: (outcome: { ok: true; count: number }) => void;
      const onAutoGeneratePage = vi.fn(
        () => new Promise<{ ok: true; count: number }>((resolve) => (finish = resolve)),
      );
      seedRun();
      render(<ControlPanel onAutoGeneratePage={onAutoGeneratePage} />);
      expect(screen.getByRole("button", { name: "Remove all" })).toBeEnabled();
      const draft = useEditorStore.getState().draftState;

      fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));

      const removeAll = screen.getByRole("button", { name: "Remove all" });
      expect(removeAll).toBeDisabled();
      fireEvent.click(removeAll);
      expect(useEditorStore.getState().draftState).toBe(draft);
      expect(screen.getByRole("status")).toHaveTextContent("Generating…");

      await act(async () => finish({ ok: true, count: 2 }));
      expect(screen.getByRole("button", { name: "Remove all" })).toBeEnabled();
      expect(screen.getByRole("status")).toBeEmptyDOMElement();
    });

    it("puts the run's seed on the result panel", () => {
      seedRun();
      render(<ControlPanel />);

      expect(screen.getByTestId("panel-auto-result")).toHaveAttribute(
        "data-run-seed",
        String(useEditorStore.getState().lastRun?.seed),
      );
    });

    it("says why a Regenerate failed", async () => {
      seedRun();
      render(
        <ControlPanel
          onAutoGeneratePage={() => Promise.resolve({ ok: false, reason: "query-failed" })}
        />,
      );

      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Regenerate" }));
      });

      expect(screen.getByRole("status")).toHaveTextContent("Couldn't read the page. Try again.");
    });

    it("keeps Regenerate and Replay all disabled with no bridge; Remove all needs none", () => {
      seedRun();
      render(<ControlPanel />);

      expect(screen.getByRole("button", { name: "Regenerate" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Replay all" })).toBeDisabled();
      expect(screen.getByRole("button", { name: "Remove all" })).toBeEnabled();
    });

    it("Replay all replays the whole page", () => {
      const onReplay = vi.fn();
      seedRun();
      render(<ControlPanel onReplay={onReplay} />);

      fireEvent.click(screen.getByRole("button", { name: "Replay all" }));

      expect(onReplay).toHaveBeenCalledExactlyOnceWith(null);
    });

    it("Remove all drops the agent's work, keeps the edited row, and closes once none is left", () => {
      seedRun();
      useEditorStore.getState().updateDraftParam("vm-h1", "duration", "1250ms");
      render(<ControlPanel />);

      fireEvent.click(screen.getByRole("button", { name: "Remove all" }));

      expect(Object.keys(useEditorStore.getState().draftState)).toEqual(["vm-h1"]);
      expect(screen.getAllByTestId("auto-result-row")).toHaveLength(1);

      act(() => useEditorStore.getState().removeDraftAssignment("vm-h1"));
      expect(screen.getByText("No generated animations left.")).toBeInTheDocument();
    });

    it("Remove all with only agent work lands on idle", () => {
      seedRun();
      render(<ControlPanel />);

      fireEvent.click(screen.getByRole("button", { name: "Remove all" }));

      expect(useEditorStore.getState().panel).toEqual({ status: "idle" });
      expect(screen.getByTestId("panel-idle")).toBeInTheDocument();
    });
  });
});

describe("ControlPanel · Export tab (Phase 7)", () => {
  const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
  const V5 = "55555555-5555-4555-8555-555555555555";
  const V3 = "33333333-3333-4333-8333-333333333333";

  const api = (path: string) => `${env.apiOrigin}${path}`;

  function version(id: string, seq: number): Version {
    return {
      id,
      projectId: PROJECT_ID,
      seq,
      label: `v${seq}`,
      parentVersionId: null,
      catalogVersion: "1.1.0",
      createdAt: "2026-09-20T10:00:00Z",
      diff: { set: {}, remove: [] },
    };
  }

  /** What the shell's `useVersionHistory` hands down; two versions, v5 current. */
  function exportHistory(overrides: Partial<VersionHistory> = {}): VersionHistory {
    return {
      versions: [version(V3, 3), version(V5, 5)],
      pending: false,
      listError: false,
      retry: () => undefined,
      currentVersionId: V5,
      viewingVersionId: null,
      viewing: false,
      viewingLabel: undefined,
      currentLabel: "v5",
      nextLabel: "v6",
      error: null,
      restoring: false,
      view: async () => undefined,
      back: () => undefined,
      restore: async () => undefined,
      ...overrides,
    };
  }

  /** Every export the panel asks for, and nothing else answered from the shared mock. */
  function mockExport(): { calls: URLSearchParams[] } {
    const calls: URLSearchParams[] = [];
    server.use(
      http.get(api("/projects/:projectId/export"), ({ request }) => {
        const query = new URL(request.url).searchParams;
        calls.push(query);
        return HttpResponse.json({
          versionId: query.get("versionId") ?? V5,
          mode: "full",
          html: "<!doctype html>",
          css: ".vm-a3 {}",
          js: null,
          files: [
            { name: "index.html", contentType: "text/html" },
            { name: "vibe-motion.css", contentType: "text/css" },
          ],
        });
      }),
      http.get(api("/projects/:projectId/versions/:versionId/state"), ({ params }) =>
        HttpResponse.json({ versionId: String(params.versionId), state: {} }),
      ),
    );
    return { calls };
  }

  function renderPanel(props: Parameters<typeof ControlPanel>[0] = {}) {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    function Wrapper({ children }: { children: ReactNode }) {
      return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    }
    return render(<ControlPanel {...props} />, { wrapper: Wrapper });
  }

  it("mounts the Export tab on the current version once the shell hands it a project", async () => {
    const { calls } = mockExport();
    useEditorStore.setState({ currentVersionId: V5 });
    renderPanel({ projectId: PROJECT_ID, projectTitle: "Nimbus App", history: exportHistory() });

    fireEvent.click(screen.getByRole("tab", { name: "Export" }));

    await waitFor(() => expect(screen.getByTestId("panel-export")).toBeInTheDocument());
    expect(calls.map((query) => query.get("versionId"))).toEqual([V5]);
  });

  it("asks for no export until the Export tab is opened", async () => {
    const { calls } = mockExport();
    useEditorStore.setState({ currentVersionId: V5 });
    renderPanel({ projectId: PROJECT_ID, history: exportHistory() });

    // The editor opens on Animate, and Base UI does not mount a closed panel.
    expect(screen.getByTestId("panel-idle")).toBeInTheDocument();
    expect(calls).toEqual([]);

    fireEvent.click(screen.getByRole("tab", { name: "Export" }));
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  it("exports the version being viewed when Export is opened from History", async () => {
    const { calls } = mockExport();
    const back = vi.fn();
    useEditorStore.setState({ mode: "viewing", currentVersionId: V5, viewingVersionId: V3 });
    renderPanel({
      projectId: PROJECT_ID,
      history: exportHistory({ viewing: true, viewingVersionId: V3, viewingLabel: "v3", back }),
    });
    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    fireEvent.click(screen.getByRole("tab", { name: "Export" }));

    // docs/user_flow.md §4: the version can be exported while viewed, without
    // restoring — and §4 again: leaving History puts the canvas back on the
    // current version, which is what `back()` does.
    await waitFor(() => expect(calls.map((query) => query.get("versionId"))).toEqual([V3]));
    expect(back).toHaveBeenCalledOnce();
    expect(await screen.findByText("v3")).toBeInTheDocument();
  });

  it("opens Export on the version a History row asked for (DT-160)", async () => {
    const { calls } = mockExport();
    const back = vi.fn();
    // What the History tab looks like with v3 on screen: only the expanded
    // (= viewed) row shows an Export button at all.
    useEditorStore.setState({ mode: "viewing", currentVersionId: V5, viewingVersionId: V3 });
    renderPanel({
      projectId: PROJECT_ID,
      history: exportHistory({ viewing: true, viewingVersionId: V3, viewingLabel: "v3", back }),
    });
    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    fireEvent.click(screen.getByRole("button", { name: "Export v3" }));

    expect(screen.getByRole("tab", { name: "Export" })).toHaveAttribute("data-active");
    await waitFor(() => expect(calls.map((query) => query.get("versionId"))).toEqual([V3]));
    expect(await screen.findByText("v3")).toBeInTheDocument();
    expect(screen.queryByText("· current")).not.toBeInTheDocument();
    // Leaving History ends the viewing, exactly as any other tab switch does.
    expect(back).toHaveBeenCalledOnce();
  });

  it("leaves Export vN disabled when there is no project behind the panel", () => {
    useEditorStore.setState({ mode: "viewing", currentVersionId: V5, viewingVersionId: V3 });
    renderPanel({
      history: exportHistory({ viewing: true, viewingVersionId: V3, viewingLabel: "v3" }),
    });
    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    expect(screen.getByRole("button", { name: "Export v3" })).toBeDisabled();
  });

  it("drops the pin when the reader leaves the Export tab and comes back", async () => {
    const { calls } = mockExport();
    useEditorStore.setState({ mode: "viewing", currentVersionId: V5, viewingVersionId: V3 });
    renderPanel({
      projectId: PROJECT_ID,
      history: exportHistory({ viewing: true, viewingVersionId: V3, viewingLabel: "v3" }),
    });
    fireEvent.click(screen.getByRole("tab", { name: "History" }));
    fireEvent.click(screen.getByRole("tab", { name: "Export" }));
    await waitFor(() => expect(calls).toHaveLength(1));

    fireEvent.click(screen.getByRole("tab", { name: "Animate" }));
    fireEvent.click(screen.getByRole("tab", { name: "Export" }));

    // Back on the current version: the pin belonged to the visit, not the tab.
    await waitFor(() => expect(calls.map((query) => query.get("versionId"))).toEqual([V3, V5]));
  });
});
