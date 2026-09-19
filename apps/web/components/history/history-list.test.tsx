import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { Assignment, Version } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION, getCatalogEntry, resolveCatalogParams } from "@/lib/catalog";

import { HistoryList } from "./history-list";

const NOW = new Date("2026-09-18T12:00:00.000Z");

function assignment(animationId: string): Assignment {
  const entry = getCatalogEntry(animationId);
  if (!entry) throw new Error(`fixture animation ${animationId} missing from the catalog`);
  return {
    animationId: entry.id,
    catalogVersion: CURRENT_CATALOG_VERSION,
    trigger: entry.defaultTrigger ?? entry.triggers[0],
    params: resolveCatalogParams(entry),
  };
}

function version(overrides: Partial<Version> & Pick<Version, "id" | "seq">): Version {
  return {
    projectId: "project-1",
    parentVersionId: null,
    label: "v" + overrides.seq,
    catalogVersion: CURRENT_CATALOG_VERSION,
    diff: { set: {}, remove: [] },
    createdAt: "2026-09-18T09:00:00.000Z",
    ...overrides,
  };
}

const V0 = version({ id: "v0", seq: 0, label: "Cloned" });
const V1 = version({
  id: "v1",
  seq: 1,
  parentVersionId: "v0",
  label: "Fade In Up on h1",
  diff: { set: { h1: assignment("fade-in-up") }, remove: [] },
});
const V2 = version({
  id: "v2",
  seq: 2,
  parentVersionId: "v1",
  label: "Pulse on .cta",
  diff: { set: { ".cta": assignment("pulse") }, remove: [] },
});

function callbacks() {
  return { onView: vi.fn(), onRestore: vi.fn() };
}

describe("HistoryList", () => {
  it("renders the versions newest first", () => {
    render(
      <HistoryList
        versions={[V0, V1, V2]}
        currentVersionId="v2"
        viewingVersionId={null}
        now={NOW}
        {...callbacks()}
      />,
    );

    const headers = screen.getAllByRole("button", { name: /^v\d/ });
    expect(headers.map((button) => button.textContent?.slice(0, 2))).toEqual(["v2", "v1", "v0"]);
  });

  it("shows v1's own diff as an added row against the empty parent state", () => {
    render(
      <HistoryList
        versions={[V0, V1, V2]}
        currentVersionId="v2"
        viewingVersionId="v1"
        now={NOW}
        {...callbacks()}
      />,
    );

    expect(screen.getByText("Added")).toHaveClass("sr-only");
    expect(screen.getByText("Fade In Up")).toBeInTheDocument();
  });

  it("names the versions after the viewed one in the footer caption", () => {
    render(
      <HistoryList
        versions={[V0, V1, V2]}
        currentVersionId="v2"
        viewingVersionId="v0"
        now={NOW}
        {...callbacks()}
      />,
    );

    expect(
      screen.getByText("Restoring creates a new version — v1 and v2 stay in the list."),
    ).toBeInTheDocument();
  });

  it("passes elementCount through to the v0 row only", () => {
    render(
      <HistoryList
        versions={[V0, V1, V2]}
        currentVersionId="v2"
        viewingVersionId={null}
        now={NOW}
        elementCount={42}
        {...callbacks()}
      />,
    );

    const cloneMeta = screen.getByText(/42 elements/);
    expect(cloneMeta.closest("button")).toHaveTextContent("v0");
    // v1 and v2 never mention an element count.
    expect(screen.queryAllByText(/elements/)).toHaveLength(1);
  });

  it("omits the caption when nothing is being viewed", () => {
    render(
      <HistoryList
        versions={[V0, V1, V2]}
        currentVersionId="v2"
        viewingVersionId={null}
        now={NOW}
        {...callbacks()}
      />,
    );

    expect(screen.queryByText(/Restoring creates a new version/)).not.toBeInTheDocument();
  });
});
