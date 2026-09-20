import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { HttpResponse, http } from "msw";
import { useEffect, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Toaster, useToastStore } from "@/components/ui/toast";
import type { Assignment, Project } from "@/lib/api-client";
import { CURRENT_CATALOG_VERSION, defaultAssignmentFor, getCatalogEntry } from "@/lib/catalog";
import { env } from "@/lib/env";
import { initialEditorState, selectDirtyVmIds, selectUnsaved, useEditorStore } from "@/lib/store";
import { saveVersion } from "@/lib/versions/api";
import { createProject, createVersion, getVersionState, listVersions, type CreateVersionInput } from "@/mocks/db";
import { server } from "@/mocks/server";

import { SaveFlowDialogs } from "./save-flow-dialogs";
import { CANNOT_SAVE_YET, useSaveFlow } from "./use-save-flow";

const api = (path: string) => `${env.apiOrigin}${path}`;

/** The hook's `requestSave`, published by the harness once it is mounted. */
let requestSave: (() => Promise<void>) | null = null;

function Harness({
  projectId,
  currentVersionLabel = "v0",
  nextVersionLabel = "v1",
  retryLoad,
}: {
  projectId: string;
  currentVersionLabel?: string;
  nextVersionLabel?: string;
  retryLoad?: () => void;
}) {
  const flow = useSaveFlow(projectId, { currentVersionLabel, nextVersionLabel, retryLoad });
  useEffect(() => {
    requestSave = flow.requestSave;
  }, [flow.requestSave]);

  return (
    <>
      <SaveFlowDialogs {...flow.dialogs} />
      <Toaster />
    </>
  );
}

function renderFlow(projectId: string, retryLoad?: () => void) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  return render(<Harness projectId={projectId} retryLoad={retryLoad} />, { wrapper: Wrapper });
}

/** What the caller of `requestSave()` learns: it resolves only on a real save. */
function startSave(): { status: "pending" | "resolved" | "rejected" } {
  const record: { status: "pending" | "resolved" | "rejected" } = { status: "pending" };
  act(() => {
    void requestSave?.().then(
      () => {
        record.status = "resolved";
      },
      () => {
        record.status = "rejected";
      },
    );
  });
  return record;
}

function assignment(animationId: string): Assignment {
  const entry = getCatalogEntry(animationId);
  if (!entry) throw new Error(`no catalog entry ${animationId}`);
  return defaultAssignmentFor(entry);
}

function animationName(animationId: string): string {
  const entry = getCatalogEntry(animationId);
  if (!entry) throw new Error(`no catalog entry ${animationId}`);
  return entry.name;
}

/** A freshly cloned project, with v0's (empty) state loaded into the store. */
function openProject(): Project {
  const created = createProject("https://example.com/pricing");
  if (created.status !== 201) throw new Error("setup: could not create the project");
  useEditorStore.getState().loadVersion(created.body.currentVersionId, {});
  return created.body;
}

/** What animating an element in the Control Panel leaves in the store. */
function animate(vmId: string, animationId = "fade-in") {
  act(() => {
    const store = useEditorStore.getState();
    store.setSelectedVmId(vmId);
    store.dispatchPanel({ type: "CHOOSE_CUSTOM" });
    store.dispatchPanel({ type: "PICK", animationId });
  });
}

/** The other tab, landing its own save on the same parent version. */
async function otherTabSaves(project: Project, vmId: string, animationId: string) {
  const theirs = assignment(animationId);
  const outcome = await saveVersion(project.id, {
    parentVersionId: project.currentVersionId,
    catalogVersion: theirs.catalogVersion,
    label: `${animationName(animationId)} on ${vmId}`,
    diff: { set: { [vmId]: theirs }, remove: [] },
  });
  if (outcome.kind !== "saved") throw new Error(`setup: the other tab's save was ${outcome.kind}`);
  return { assignment: theirs, version: outcome.version };
}

beforeEach(() => {
  requestSave = null;
  useEditorStore.setState({ ...initialEditorState });
  useToastStore.setState({ current: null });
});

describe("useSaveFlow", () => {
  it("opens the Save dialog on the draft's own diff, prefilled from it", async () => {
    const project = openProject();
    animate("vm-1");
    renderFlow(project.id);

    startSave();

    const dialog = await screen.findByRole("dialog", { name: "Save as v1" });
    expect(within(dialog).getByText("from v0")).toBeInTheDocument();
    expect(within(dialog).getByRole("textbox", { name: "Label" })).toHaveValue(
      `${animationName("fade-in")} on vm-1`,
    );
    expect(within(dialog).getByText("vm-1")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Save version" })).toBeEnabled();
  });

  it("writes the draft as a new version, moves the store on to it and says so", async () => {
    const project = openProject();
    animate("vm-1");
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });

    fireEvent.click(screen.getByRole("button", { name: "Save version" }));

    await waitFor(() => expect(flow.status).toBe("resolved"));
    const listed = listVersions(project.id);
    expect(listed?.versions.map((version) => version.seq)).toEqual([0, 1]);
    const state = useEditorStore.getState();
    expect(state.currentVersionId).toBe(listed?.versions[1].id);
    expect(selectUnsaved(state)).toBe(false);
    expect(await screen.findByText("Saved v1")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("promotes what it posted when the draft moves while the 201 is in flight", async () => {
    // Nothing in the editor can do this behind the modal today; Phase 5's
    // async agent writes can. Skipping the promotion left the chip, the parent
    // pointer and "unsaved" all describing a version that had been written.
    const project = openProject();
    animate("vm-1");
    let release = () => {};
    let asked = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inFlight = new Promise<void>((resolve) => {
      asked = resolve;
    });
    server.use(
      http.post(api("/projects/:projectId/versions"), async ({ request, params }) => {
        asked();
        await gate;
        const written = createVersion(
          String(params.projectId),
          (await request.json()) as CreateVersionInput,
        );
        return HttpResponse.json(written.body, { status: written.status });
      }),
    );
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });

    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    await act(async () => {
      await inFlight;
    });
    // The write is out; this edit is not in it.
    const late = assignment("pulse");
    act(() => {
      useEditorStore.getState().setDraftAssignment("vm-2", late);
    });
    await act(async () => {
      release();
      await gate;
    });

    await waitFor(() => expect(flow.status).toBe("resolved"));
    const listed = listVersions(project.id);
    const state = useEditorStore.getState();
    expect(state.currentVersionId).toBe(listed?.versions[1].id);
    // The version that was written, not the draft as it stands: "unsaved" then
    // means exactly the late edit.
    expect(state.currentVersionState).toEqual({ "vm-1": assignment("fade-in") });
    expect(state.draftState).toEqual({ "vm-1": assignment("fade-in"), "vm-2": late });
    expect(selectUnsaved(state)).toBe(true);
    expect(selectDirtyVmIds(state)).toEqual(["vm-2"]);
    expect(await screen.findByText("Saved v1")).toBeInTheDocument();
  });

  it("posts the label the user typed, not the prefill", async () => {
    const project = openProject();
    animate("vm-1");
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });

    fireEvent.change(screen.getByRole("textbox", { name: "Label" }), {
      target: { value: "Hero entrance" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));

    await waitFor(() => expect(flow.status).toBe("resolved"));
    expect(listVersions(project.id)?.versions[1].label).toBe("Hero entrance");
  });

  it("saves a draft touching a dozen elements without the prefilled label tripping the contract's cap", async () => {
    // Phase 5's auto-generate on a page with a dozen elements is the normal
    // shape of the first Save after it, not a contrived edge case — and
    // before the cap, "Fade In Up on vm-1xx" joined with no limit for 10+
    // rows regularly cleared 200 characters and got a 400 back from the
    // service (the brief's own example: ×10 is already 218 characters).
    const project = openProject();
    for (let i = 1; i <= 12; i += 1) {
      animate(`vm-1${i}`, "fade-in-up");
    }
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });
    expect(screen.getByRole("textbox", { name: "Label" }).getAttribute("value")?.length).toBeLessThanOrEqual(
      200,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save version" }));

    await waitFor(() => expect(flow.status).toBe("resolved"));
    const posted = listVersions(project.id)?.versions[1];
    expect(posted?.label.length).toBeLessThanOrEqual(200);
  });

  it("sends a whitespace-only label as omitted, so the service generates one", async () => {
    const project = openProject();
    animate("vm-1");
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });

    fireEvent.change(screen.getByRole("textbox", { name: "Label" }), {
      target: { value: "   " },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));

    await waitFor(() => expect(flow.status).toBe("resolved"));
    const posted = listVersions(project.id)?.versions[1];
    expect(posted?.label).not.toBe("   ");
    expect(posted?.label).toBeTruthy();
  });

  it("writes nothing on Cancel, and leaves the draft exactly as it was", async () => {
    const project = openProject();
    animate("vm-1");
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(flow.status).toBe("rejected"));
    expect(listVersions(project.id)?.versions).toHaveLength(1);
    expect(useEditorStore.getState().draftState).toEqual({ "vm-1": assignment("fade-in") });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("refuses a clean draft without opening anything", async () => {
    const project = openProject();
    renderFlow(project.id);

    const flow = startSave();

    await waitFor(() => expect(flow.status).toBe("rejected"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(listVersions(project.id)?.versions).toHaveLength(1);
  });

  it("says why it cannot save yet, and asks for the failed load again", async () => {
    // The project's open load never landed, so there is no parent version to
    // fork from. Refusing in silence left an enabled Save button that did
    // nothing at all.
    const created = createProject("https://example.com/pricing");
    if (created.status !== 201) throw new Error("setup: could not create the project");
    const retryLoad = vi.fn();
    animate("vm-1");
    renderFlow(created.body.id, retryLoad);

    const flow = startSave();

    await waitFor(() => expect(flow.status).toBe("rejected"));
    expect(await screen.findByText(CANNOT_SAVE_YET)).toBeInTheDocument();
    expect(retryLoad).toHaveBeenCalledOnce();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(listVersions(created.body.id)?.versions).toHaveLength(1);
  });

  it("refuses to save while a past version is being viewed", async () => {
    const project = openProject();
    renderFlow(project.id);
    act(() => {
      useEditorStore.getState().enterViewing("some-older-version", { "vm-1": assignment("pulse") });
    });

    const flow = startSave();

    // `markSaved` throws while viewing, so Save must never become a backdoor
    // restore: Restore is the action that writes a version here.
    await waitFor(() => expect(flow.status).toBe("rejected"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("hands a second caller the dialog that is already open", async () => {
    const project = openProject();
    animate("vm-1");
    renderFlow(project.id);

    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    act(() => {
      first = requestSave?.();
      second = requestSave?.();
      void first?.catch(() => {});
      void second?.catch(() => {});
    });

    // The top bar and a guard can both ask; one dialog, one write, one answer.
    expect(second).toBe(first);
    expect(await screen.findAllByRole("dialog")).toHaveLength(1);
  });

  it("keeps the dialog open with the service's reason when the save is refused", async () => {
    const project = openProject();
    const unknown: Assignment = {
      animationId: "not-an-animation",
      catalogVersion: CURRENT_CATALOG_VERSION,
      trigger: "load",
      params: {},
    };
    act(() => {
      useEditorStore.getState().setDraftAssignment("vm-1", unknown);
    });
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });

    fireEvent.click(screen.getByRole("button", { name: "Save version" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/No animation "not-an-animation"/);
    expect(screen.getByRole("dialog", { name: "Save as v1" })).toBeInTheDocument();
    // Nothing was written and nothing was promoted: the draft is still the
    // user's to fix.
    expect(listVersions(project.id)?.versions).toHaveLength(1);
    expect(useEditorStore.getState().draftState).toEqual({ "vm-1": unknown });
    expect(flow.status).toBe("pending");
  });

  it("shows a failure that is nobody's fault in place, without touching the draft", async () => {
    const project = openProject();
    animate("vm-1");
    server.use(
      http.post(api("/projects/:projectId/versions"), () =>
        HttpResponse.json({ code: "internal_error", message: "Unhandled failure" }, { status: 500 }),
      ),
    );
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });

    fireEvent.click(screen.getByRole("button", { name: "Save version" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Unhandled failure");
    expect(useEditorStore.getState().draftState).toEqual({ "vm-1": assignment("fade-in") });
    expect(flow.status).toBe("pending");
  });

  it("retries a busy project once, and saves", async () => {
    const project = openProject();
    animate("vm-1");
    server.use(
      http.post(
        api("/projects/:projectId/versions"),
        () => new HttpResponse(null, { status: 503, headers: { "Retry-After": "0" } }),
        { once: true },
      ),
    );
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });

    fireEvent.click(screen.getByRole("button", { name: "Save version" }));

    // The retry waits out `Retry-After` before the second attempt.
    await waitFor(() => expect(flow.status).toBe("resolved"), { timeout: 3000 });
    expect(listVersions(project.id)?.versions).toHaveLength(2);
  });

  it("says so rather than retrying for ever when the project stays busy", async () => {
    const project = openProject();
    animate("vm-1");
    let attempts = 0;
    server.use(
      http.post(api("/projects/:projectId/versions"), () => {
        attempts += 1;
        return new HttpResponse(null, { status: 503, headers: { "Retry-After": "0" } });
      }),
    );
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });

    fireEvent.click(screen.getByRole("button", { name: "Save version" }));

    expect(
      await screen.findByText("The project is busy. Try again in a moment.", undefined, {
        timeout: 3000,
      }),
    ).toBeInTheDocument();
    expect(attempts).toBe(2);
    expect(flow.status).toBe("pending");
  });
});

describe("useSaveFlow · saved somewhere else", () => {
  it("asks what to do when another tab saved first", async () => {
    const project = openProject();
    animate("vm-1");
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });
    await otherTabSaves(project, "vm-2", "pulse");

    fireEvent.click(screen.getByRole("button", { name: "Save version" }));

    const conflict = await screen.findByRole("dialog", { name: "v1 was saved somewhere else" });
    expect(within(conflict).getByText(/Pulse on vm-2/)).toBeInTheDocument();
    expect(screen.queryByTestId("save-dialog")).not.toBeInTheDocument();
    // Undecided: the caller is still waiting, and nothing of the draft moved.
    expect(flow.status).toBe("pending");
    expect(useEditorStore.getState().draftState).toEqual({ "vm-1": assignment("fade-in") });
  });

  it("rebases on top of theirs and asks the user to confirm the second write", async () => {
    const project = openProject();
    animate("vm-1");
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });
    const theirs = await otherTabSaves(project, "vm-2", "pulse");
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    await screen.findByRole("dialog", { name: "v1 was saved somewhere else" });

    fireEvent.click(screen.getByRole("button", { name: "Apply my changes on top" }));

    // Back to the Save dialog rather than an automatic retry: the write the
    // user confirmed is not the write this would make.
    const again = await screen.findByTestId("save-dialog");
    expect(within(again).getByText("vm-1")).toBeInTheDocument();
    expect(within(again).queryByText("vm-2")).not.toBeInTheDocument();
    expect(flow.status).toBe("pending");

    fireEvent.click(within(again).getByRole("button", { name: "Save version" }));

    await waitFor(() => expect(flow.status).toBe("resolved"));
    const listed = listVersions(project.id);
    expect(listed?.versions).toHaveLength(3);
    expect(getVersionState(project.id, listed?.currentVersionId ?? "")?.state).toEqual({
      "vm-1": assignment("fade-in"),
      "vm-2": theirs.assignment,
    });
  });

  it("resolves without a second write when their save already contains my change", async () => {
    const project = openProject();
    animate("vm-1");
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });
    await otherTabSaves(project, "vm-1", "fade-in");
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    await screen.findByRole("dialog", { name: "v1 was saved somewhere else" });

    fireEvent.click(screen.getByRole("button", { name: "Apply my changes on top" }));

    await waitFor(() => expect(flow.status).toBe("resolved"));
    // An empty diff is not a version (CLAUDE.md rule 9), and the guard that
    // asked for a save has still had its answer.
    expect(listVersions(project.id)?.versions).toHaveLength(2);
    expect(await screen.findByText("Already saved in v1")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("loads their version on Discard my changes, and reports that nothing was saved", async () => {
    const project = openProject();
    animate("vm-1");
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });
    const theirs = await otherTabSaves(project, "vm-2", "pulse");
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    await screen.findByRole("dialog", { name: "v1 was saved somewhere else" });

    fireEvent.click(screen.getByRole("button", { name: "Discard my changes" }));

    // Rejected, not resolved: a guard that asked "save first?" must not treat
    // this as a save and let the action it was guarding through.
    await waitFor(() => expect(flow.status).toBe("rejected"));
    const state = useEditorStore.getState();
    expect(state.draftState).toEqual({ "vm-2": theirs.assignment });
    expect(state.currentVersionState).toEqual({ "vm-2": theirs.assignment });
    expect(state.currentVersionId).toBe(theirs.version.id);
    expect(selectUnsaved(state)).toBe(false);
    expect(listVersions(project.id)?.versions).toHaveLength(2);
    expect(await screen.findByText("Loaded v1")).toBeInTheDocument();
  });

  it("leaves everything alone on Keep editing", async () => {
    const project = openProject();
    animate("vm-1");
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });
    await otherTabSaves(project, "vm-2", "pulse");
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    await screen.findByRole("dialog", { name: "v1 was saved somewhere else" });

    fireEvent.click(screen.getByRole("button", { name: "Keep editing" }));

    await waitFor(() => expect(flow.status).toBe("rejected"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useEditorStore.getState().draftState).toEqual({ "vm-1": assignment("fade-in") });
    expect(listVersions(project.id)?.versions).toHaveLength(2);
  });

  it("refuses a second answer while the first is still being carried out", async () => {
    const project = openProject();
    animate("vm-1");
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });
    await otherTabSaves(project, "vm-2", "pulse");
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    await screen.findByRole("dialog", { name: "v1 was saved somewhere else" });

    let release = () => {};
    let asked = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inFlight = new Promise<void>((resolve) => {
      asked = resolve;
    });
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), async ({ params }) => {
        asked();
        await gate;
        return HttpResponse.json({ versionId: params.versionId, state: {} });
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply my changes on top" }));
    await act(async () => {
      await inFlight;
    });

    for (const name of ["Discard my changes", "Keep editing", "Apply my changes on top"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(flow.status).toBe("pending");

    await act(async () => {
      release();
      await gate;
    });
  });

  it("keeps the question standing when their version cannot be loaded", async () => {
    const project = openProject();
    animate("vm-1");
    renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });
    await otherTabSaves(project, "vm-2", "pulse");
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    await screen.findByRole("dialog", { name: "v1 was saved somewhere else" });
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), () =>
        HttpResponse.json(
          { code: "internal_error", message: "Could not materialise that version" },
          { status: 500 },
        ),
      ),
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply my changes on top" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Could not materialise that version",
    );
    expect(screen.getByRole("dialog", { name: "v1 was saved somewhere else" })).toBeInTheDocument();
    expect(flow.status).toBe("pending");
    expect(useEditorStore.getState().draftState).toEqual({ "vm-1": assignment("fade-in") });
  });

  it("rejects rather than rebasing onto a project the reader has since left", async () => {
    // Same hazard `useProjectVersions` and `useVersionHistory` already guard
    // against: theirs' `/state` answers after the reader has moved to another
    // project (the shell resets the store and changes `projectId` without
    // remounting this hook), and must not be replayed into whatever draft is
    // in the store now.
    const project = openProject();
    const other = openProject();
    animate("vm-1");
    const view = renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });
    await otherTabSaves(project, "vm-2", "pulse");
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    await screen.findByRole("dialog", { name: "v1 was saved somewhere else" });

    let release = () => {};
    let asked = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inFlight = new Promise<void>((resolve) => {
      asked = resolve;
    });
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), async ({ params }) => {
        asked();
        await gate;
        return HttpResponse.json({ versionId: params.versionId, state: {} });
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply my changes on top" }));
    await act(async () => {
      await inFlight;
    });

    // What the shell does on a project change: same mount, new `projectId`.
    view.rerender(<Harness projectId={other.id} />);
    await act(async () => {
      release();
      await gate;
    });

    // Rejected — not resolved, not left pending — and theirs never landed in
    // the draft this project's editor is still showing.
    await waitFor(() => expect(flow.status).toBe("rejected"));
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(useEditorStore.getState().draftState).toEqual({ "vm-1": assignment("fade-in") });
  });

  it("rejects rather than discarding into a project the reader has since left", async () => {
    const project = openProject();
    const other = openProject();
    animate("vm-1");
    const view = renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });
    const theirs = await otherTabSaves(project, "vm-2", "pulse");
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    await screen.findByRole("dialog", { name: "v1 was saved somewhere else" });

    let release = () => {};
    let asked = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inFlight = new Promise<void>((resolve) => {
      asked = resolve;
    });
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), async ({ params }) => {
        asked();
        await gate;
        return HttpResponse.json({ versionId: params.versionId, state: theirs.assignment });
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Discard my changes" }));
    await act(async () => {
      await inFlight;
    });

    view.rerender(<Harness projectId={other.id} />);
    await act(async () => {
      release();
      await gate;
    });

    await waitFor(() => expect(flow.status).toBe("rejected"));
    expect(useEditorStore.getState().draftState).toEqual({ "vm-1": assignment("fade-in") });
    expect(useToastStore.getState().current).toBeNull();
  });

  it("says nothing into the void when the rebase's own project outlives the tab", async () => {
    const project = openProject();
    animate("vm-1");
    const view = renderFlow(project.id);
    const flow = startSave();
    await screen.findByRole("dialog", { name: "Save as v1" });
    await otherTabSaves(project, "vm-1", "fade-in");
    fireEvent.click(screen.getByRole("button", { name: "Save version" }));
    await screen.findByRole("dialog", { name: "v1 was saved somewhere else" });

    let release = () => {};
    let asked = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const inFlight = new Promise<void>((resolve) => {
      asked = resolve;
    });
    server.use(
      http.get(api("/projects/:projectId/versions/:versionId/state"), async ({ params }) => {
        asked();
        await gate;
        const found = getVersionState(String(params.projectId), String(params.versionId));
        return HttpResponse.json(found);
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Apply my changes on top" }));
    await act(async () => {
      await inFlight;
    });
    view.unmount();
    await act(async () => {
      release();
      await gate;
    });

    // The rebase concluded "already saved" — a real outcome — but a toast for
    // a screen that is gone belongs to nobody.
    await waitFor(() => expect(flow.status).toBe("resolved"));
    expect(useToastStore.getState().current).toBeNull();
  });
});
