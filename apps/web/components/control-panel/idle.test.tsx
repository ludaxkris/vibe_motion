import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { EditorStateMap } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION, getCatalogEntry, resolveCatalogParams } from "@/lib/catalog";

import { IdlePanel as RawIdlePanel } from "./idle";

/** The prompt is controlled; most cases here do not care about it. */
function IdlePanel(props: Partial<React.ComponentProps<typeof RawIdlePanel>>) {
  return <RawIdlePanel assignments={{}} prompt="" onPromptChange={() => undefined} {...props} />;
}

function draftWith(vmId: string, animationId: string): EditorStateMap {
  const entry = getCatalogEntry(animationId)!;
  return {
    [vmId]: {
      animationId: entry.id,
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: entry.defaultTrigger ?? entry.triggers[0],
      params: resolveCatalogParams(entry),
    },
  };
}

describe("IdlePanel", () => {
  it("invites the user to click an element, and says how to get back out", () => {
    render(<IdlePanel />);

    expect(screen.getByTestId("panel-idle")).toBeInTheDocument();
    expect(screen.getByText("Click any element to animate it")).toBeInTheDocument();
    expect(screen.getByText(/hover outlines the element/i)).toBeInTheDocument();
    // Esc reads as a key, not as prose.
    expect(screen.getByText("Esc").tagName).toBe("KBD");
  });

  it("offers the whole-page prompt, controlled by `prompt`", () => {
    const onPromptChange = vi.fn();
    render(<IdlePanel prompt="calm and slow" onPromptChange={onPromptChange} />);

    expect(screen.getByText("Whole page")).toBeInTheDocument();
    const prompt = screen.getByLabelText("Describe the feel");
    expect(prompt.tagName).toBe("TEXTAREA");
    expect(prompt).toHaveAttribute(
      "placeholder",
      "Describe the feel — 'calm, staggered entrances, nothing loops'",
    );
    expect(prompt).toHaveValue("calm and slow");

    fireEvent.change(prompt, { target: { value: "bouncy" } });

    expect(onPromptChange).toHaveBeenCalledWith("bouncy");
    // Controlled: the value only moves when the prop does.
    expect(prompt).toHaveValue("calm and slow");
  });

  it("says, on the textarea and beside it, that the v0 agent ignores the prompt (plan D8)", () => {
    render(<IdlePanel />);

    const copy = "The v0 agent picks at random and ignores this text.";
    expect(screen.getByLabelText("Describe the feel")).toHaveAttribute("title", copy);
    expect(screen.getByText(copy)).toBeInTheDocument();
    expect(screen.queryByText(/arrives with the mock agent/i)).not.toBeInTheDocument();
  });

  it("keeps auto-generate disabled until there is something to run it", () => {
    render(<IdlePanel />);

    expect(screen.getByRole("button", { name: "Auto-generate for this page" })).toBeDisabled();
  });

  it("runs auto-generate on click", () => {
    const onAutoGenerate = vi.fn();
    render(<IdlePanel onAutoGenerate={onAutoGenerate} />);

    fireEvent.click(screen.getByRole("button", { name: "Auto-generate for this page" }));

    expect(onAutoGenerate).toHaveBeenCalledOnce();
  });

  it("shows a busy, disabled button while a run is in flight", () => {
    const onAutoGenerate = vi.fn();
    render(<IdlePanel onAutoGenerate={onAutoGenerate} busy />);

    const button = screen.getByRole("button", { name: "Generating…" });
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute("aria-busy", "true");
    fireEvent.click(button);
    expect(onAutoGenerate).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Auto-generate for this page" })).not.toBeInTheDocument();
  });

  it.each([
    ["query-failed", "Couldn't read the page. Try again."],
    ["agent-failed", "Couldn't read the page. Try again."],
    ["no-targets", "Nothing on this page looks worth animating."],
  ] as const)("says why a run failed: %s", (error, copy) => {
    render(<IdlePanel onAutoGenerate={() => undefined} error={error} />);

    expect(screen.getByRole("status")).toHaveTextContent(copy);
  });

  it("has no status line while nothing failed", () => {
    render(<IdlePanel onAutoGenerate={() => undefined} />);

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("hides the animated list until something is animated", () => {
    render(<IdlePanel />);

    expect(screen.queryByText(/^Animated ·/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /replay all/i })).not.toBeInTheDocument();
  });

  it("lists every animated element with its animation and meta, and counts them", () => {
    render(<IdlePanel assignments={{ ...draftWith("vm-3", "fade-in-up"), ...draftWith("vm-9", "pulse") }} />);

    expect(screen.getByText("Animated · 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Fade In Up on vm-3/ })).toBeInTheDocument();
    expect(screen.getByText("vm-3")).toBeInTheDocument();
    expect(screen.getByText("load · 600ms · 0ms")).toBeInTheDocument();
  });

  it("selects the element a row names when the row is clicked", () => {
    const onSelectElement = vi.fn();
    render(<IdlePanel assignments={draftWith("vm-3", "fade-in-up")} onSelectElement={onSelectElement} />);

    fireEvent.click(screen.getByRole("button", { name: /Fade In Up on vm-3/ }));

    expect(onSelectElement).toHaveBeenCalledWith("vm-3");
  });

  it("names a row's animation from the version that row's assignment pinned", () => {
    render(
      <IdlePanel
        assignments={{
          "vm-3": {
            animationId: "fade-in-up",
            // A version this browser has no catalog for: the id is the honest
            // label, rather than the *current* catalog's name for an entry
            // this assignment was never authored against.
            catalogVersion: "9.9.9",
            trigger: "load",
            params: { duration: "600ms", delay: "0ms" },
          },
        }}
      />,
    );

    expect(screen.getByRole("button", { name: /fade-in-up on vm-3/ })).toBeInTheDocument();
    expect(screen.queryByText("Fade In Up")).not.toBeInTheDocument();
  });

  it("keeps Replay all disabled until there is a bridge to replay through", () => {
    render(<IdlePanel assignments={draftWith("vm-3", "fade-in-up")} />);

    expect(screen.getByRole("button", { name: "Replay all" })).toBeDisabled();
  });

  it("replays every animation when Replay all is clicked", () => {
    const onReplayAll = vi.fn();
    render(<IdlePanel assignments={draftWith("vm-3", "fade-in-up")} onReplayAll={onReplayAll} />);

    fireEvent.click(screen.getByRole("button", { name: "Replay all" }));

    expect(onReplayAll).toHaveBeenCalledOnce();
  });
});
