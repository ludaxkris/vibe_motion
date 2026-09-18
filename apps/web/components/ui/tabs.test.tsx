import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "./tabs";

function renderFolderTabs(onValueChange = vi.fn()) {
  render(
    <Tabs defaultValue="animate" onValueChange={onValueChange}>
      <TabsList variant="folder" aria-label="Panel">
        <TabsTrigger value="animate">Animate</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
        <TabsTrigger value="export">Export</TabsTrigger>
      </TabsList>
      <TabsContent value="animate">Animate body</TabsContent>
      <TabsContent value="history">History body</TabsContent>
      <TabsContent value="export">Export body</TabsContent>
    </Tabs>,
  );
  return onValueChange;
}

describe("Tabs", () => {
  it("still switches panels", () => {
    const onValueChange = renderFolderTabs();

    expect(screen.getByText("Animate body")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "History" }));

    expect(onValueChange).toHaveBeenCalledWith("history", expect.anything());
    expect(screen.getByText("History body")).toBeInTheDocument();
  });

  it("attaches the folder tabs to the card below them", () => {
    renderFolderTabs();

    const list = screen.getByRole("tablist", { name: "Panel" });
    expect(list).toHaveAttribute("data-variant", "folder");
    expect(list).toHaveClass("gap-0.5", "px-3", "pt-3");

    const active = screen.getByRole("tab", { name: "Animate" });
    expect(active.className).toContain(
      "group-data-[variant=folder]/tabs-list:data-active:bg-vm-surface",
    );
    expect(active.className).toContain(
      "group-data-[variant=folder]/tabs-list:data-active:text-vm-accent-strong",
    );
  });

  it("keeps the default variant working for other tab rows", () => {
    render(
      <Tabs defaultValue="one">
        <TabsList aria-label="Files">
          <TabsTrigger value="one">index.html</TabsTrigger>
        </TabsList>
        <TabsContent value="one">body</TabsContent>
      </Tabs>,
    );

    expect(screen.getByRole("tablist", { name: "Files" })).toHaveClass("bg-vm-surface-muted");
  });
});
