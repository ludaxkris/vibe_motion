import { act, render, screen } from "@testing-library/react";
import { Profiler, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { initialEditorState, useEditorStore } from "@/lib/store";

import { ControlPanel } from "./index";

/**
 * What a slider tick costs the Control Panel, measured rather than asserted in
 * prose (DT-126).
 *
 * The probe is `paramControl`, which every `ParamControlFor` calls exactly
 * once per render: the keys it is asked about are the rows that re-rendered.
 * Deterministic, and independent of wall-clock time — the numbers in
 * `apps/e2e/web/mocked/bridge-perf.spec.ts` are the consequence, this is the
 * cause.
 */
const { renderedRows } = vi.hoisted(() => ({ renderedRows: [] as string[] }));

vi.mock("./param-control", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./param-control")>();
  return {
    ...actual,
    paramControl: (param: Parameters<typeof actual.paramControl>[0], value?: string) => {
      renderedRows.push(param.key);
      return actual.paramControl(param, value);
    },
  };
});

/** `fade-in-up` as of catalog 1.1.0 — five param rows. */
const ROWS = ["duration", "delay", "easing", "fillMode", "distance"];

function tuning(vmId = "vm-1", animationId = "fade-in-up") {
  const store = useEditorStore.getState();
  store.setSelectedVmId(vmId);
  store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
  store.dispatchPanel({ type: "PICK", animationId });
}

/** Counts commits that include the panel subtree. */
function profiled(children: ReactNode) {
  const commits: string[] = [];
  const onRender = (_id: string, phase: string) => commits.push(phase);
  return {
    commits,
    element: (
      <Profiler id="panel" onRender={onRender as never}>
        {children}
      </Profiler>
    ),
  };
}

beforeEach(() => {
  useEditorStore.setState({ ...initialEditorState });
  renderedRows.length = 0;
});

describe("Control Panel render cost", () => {
  it("renders every row once on the way into tuning", () => {
    tuning();
    render(<ControlPanel />);

    expect(screen.getByTestId("panel-tuning")).toBeInTheDocument();
    expect([...new Set(renderedRows)].sort()).toEqual([...ROWS].sort());
  });

  it("re-renders only the row whose param changed", () => {
    tuning();
    render(<ControlPanel />);
    renderedRows.length = 0;

    act(() => {
      useEditorStore.getState().updateDraftParam("vm-1", "duration", "700ms");
    });

    // One row, and it is the one the designer moved. Before DT-126 this was
    // all five, plus the tabs, both guard computations and the dialog.
    expect(renderedRows).toEqual(["duration"]);
  });

  it("stays at one row per tick over a whole drag", () => {
    tuning();
    render(<ControlPanel />);
    renderedRows.length = 0;

    act(() => {
      for (let tick = 0; tick < 10; tick += 1) {
        useEditorStore.getState().updateDraftParam("vm-1", "duration", `${600 + tick}ms`);
      }
    });

    // React batches the ten writes in one act, so the assertion is "the other
    // four rows never re-rendered", not "ten renders".
    expect(new Set(renderedRows)).toEqual(new Set(["duration"]));
  });

  it("changing one param does not re-render another param's row", () => {
    tuning();
    render(<ControlPanel />);
    renderedRows.length = 0;

    act(() => {
      useEditorStore.getState().updateDraftParam("vm-1", "distance", "40px");
    });

    expect(renderedRows).toEqual(["distance"]);
  });

  it("a hover report from the iframe re-renders nothing in the panel", () => {
    tuning();
    const { commits, element } = profiled(<ControlPanel />);
    render(element);
    commits.length = 0;
    renderedRows.length = 0;

    act(() => {
      useEditorStore.getState().setHoverVmId("vm-9");
    });
    act(() => {
      useEditorStore.getState().setHoverVmId("vm-4");
    });

    expect(commits).toEqual([]);
    expect(renderedRows).toEqual([]);
  });

  it("does not re-render the panel when another element's draft changes", () => {
    tuning();
    const { commits, element } = profiled(<ControlPanel />);
    render(element);
    commits.length = 0;
    renderedRows.length = 0;

    act(() => {
      useEditorStore.getState().updateDraftParam("vm-other", "duration", "900ms");
    });

    // `vm-other` has no draft assignment, so the store returns the same state
    // and nothing anywhere should hear about it.
    expect(commits).toEqual([]);
    expect(renderedRows).toEqual([]);
  });
});
