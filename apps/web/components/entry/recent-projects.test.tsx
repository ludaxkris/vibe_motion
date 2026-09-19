import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import type { RecentProject } from "@/lib/recent-projects";

import { RecentProjects } from "./recent-projects";

const NOW = new Date("2026-09-18T12:00:00.000Z");

const project = (over: Partial<RecentProject> = {}): RecentProject => ({
  id: "proj_1",
  title: "nimbus.app/pricing",
  sourceUrl: "https://nimbus.app/pricing",
  openedAt: "2026-09-18T10:00:00.000Z",
  ...over,
});

describe("RecentProjects", () => {
  it("renders nothing at all when this browser has opened nothing", () => {
    const { container } = render(<RecentProjects projects={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("names each row for what following it does", () => {
    render(<RecentProjects projects={[project()]} now={NOW} />);

    expect(screen.getByRole("link", { name: "Open nimbus.app/pricing" })).toHaveAttribute(
      "href",
      "/p/proj_1",
    );
  });

  it("shows the handoff's meta line: host, then how long ago", () => {
    render(<RecentProjects projects={[project()]} now={NOW} />);

    const row = screen.getByRole("listitem");
    expect(within(row).getByText("nimbus.app/pricing")).toBeInTheDocument();
    expect(within(row).getByText("nimbus.app · 2h ago")).toBeInTheDocument();
  });

  it("keeps the order it is given, most recent first", () => {
    render(
      <RecentProjects
        projects={[
          project({ id: "proj_1", title: "newest" }),
          project({ id: "proj_2", title: "older", openedAt: "2026-09-17T12:00:00.000Z" }),
        ]}
        now={NOW}
      />,
    );

    expect(screen.getAllByRole("listitem").map((row) => row.textContent)).toEqual([
      expect.stringContaining("newest"),
      expect.stringContaining("older"),
    ]);
  });

  it("explains that a recent project opens at its current version", () => {
    render(<RecentProjects projects={[project()]} now={NOW} />);

    expect(screen.getByText(/loads its current version/i)).toBeInTheDocument();
  });

  it("drops to half opacity while a clone is running", () => {
    const { rerender } = render(<RecentProjects projects={[project()]} now={NOW} />);
    const column = screen.getByRole("region", { name: "Recent projects" });
    expect(column).not.toHaveClass("opacity-50");

    rerender(<RecentProjects projects={[project()]} now={NOW} dimmed />);
    expect(column).toHaveClass("opacity-50");
  });

  it("has no 'View all': there is no endpoint behind it", () => {
    render(<RecentProjects projects={[project()]} now={NOW} />);

    expect(screen.queryByText(/view all/i)).not.toBeInTheDocument();
  });
});
