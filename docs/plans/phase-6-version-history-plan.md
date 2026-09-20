# Phase 6 — Version history and restore: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A working Save button, a History tab listing versions, read-only viewing of any version in the preview, Restore, and a handled 409 when another tab saved first.

**Architecture:** The API half shipped in Phase 2 (`listVersions`, `createVersion`, `getVersionState`, `restoreVersion`), and the MSW mock already returns 409 `stale_parent` and folds diffs for `/state`. Phase 6 is web-only: a pure `lib/versions/` module (diff, rebase, API outcomes, query hooks, mode transitions), presentational `components/history/` pieces, then a thin integration layer that wires them into the Phase 4 store factory, bridge client (`state:load`) and lifted guard.

**Tech stack:** TypeScript strict, Zustand, TanStack Query, `openapi-fetch` client (`@/lib/api-client`), MSW, Vitest + RTL, Playwright (`apps/e2e/web/stack/`).

**Spec:** `docs/build_plan.md` "Phase 6", `docs/user_flow.md` §3–§4 and the mode table, `docs/design/README.md` "History tab", "Unsaved guard", "Interactions" (409 line). Scope decision from Chris (2026-09-18): **core only** — DT-016 (localStorage draft), DT-062 (restore parent check) and DT-117 (Esc while dirty) stay deferred.

## Status (2026-09-20)

Tracks A and B implemented. Deviations accepted in review:

- `requestSave(): Promise<void>` is the contract both guards depend on; the guard was **not** lifted (DT-099 stays open).
- The History hook (`useVersionHistory`) is mounted once in the shell so the row and the banner share one `restoring` flag.
- `elementCount` is omitted from v0's row (DT-159).
- `inert` sits on the `<iframe>`, not the sheet wrapper (DT-161).
- `markSaved(version, posted)` promotes the `posted` draft, not whatever the draft has become by the time the 201 lands.
- An edit made before the project-open load lands is rebased onto it rather than overwritten or abandoned.
- Esc exits viewing (returns to the current version) instead of deselecting.
- `setMode` was removed; PR #21 must use `store.setState({ mode: "viewing" })` in its tests.
- Deferred follow-ups are logged as DT-154..DT-167.

## Global constraints

- **One branch, one PR:** `feat/6-version-history`, opened as a PR only after `feat/4-bridge-integration` merges (Chris's call). Track A below is committed to the branch early; nothing is pushed for review until Track B is done.
- **Track A creates files only.** Until Phase 4 *and* Phase 5 Track A have merged, this branch must not modify any of: `apps/web/lib/store/*`, `apps/web/components/control-panel/*`, `apps/web/components/editor/editor-shell.tsx`, `apps/web/app/dev/dev-gallery.tsx`, `apps/web/app/mock-api/**`, `apps/web/lib/preview-url.ts`, `apps/web/package.json`, `apps/web/next.config.ts`, `apps/web/lib/bridge/**`, `apps/web/lib/agent/**`, `packages/bridge/**`, `apps/api/**`. (Sources: memory.md Phase 4 entry and Phase 5 notice; `docs/plans/phase-5-agent-flows.md` on PR #14.)
- No contract change. `openapi.yaml` is untouched; do not regenerate the client.
- CLAUDE.md rule 9: a version is created only by Save; live edits never call the API; every `set` entry carries `catalogVersion` (it already does — it is an `Assignment`).
- Existing assignments resolve names with `getCatalogEntryAt(assignment.catalogVersion, id)` (`lib/catalog.ts`), never the current catalog.
- Version labels are `v<seq>`. Query key for the list is the existing `["project", projectId, "versions"]`.
- TDD, conventional commits, attribution line at the end of every commit message.

## File structure

Track A (all new):

```
apps/web/lib/versions/diff.ts            computeDiff, applyDiff, isEmptyDiff, statesBySeq
apps/web/lib/versions/api.ts             saveVersion / restoreVersion / fetchVersionState → typed outcomes (no React)
apps/web/lib/versions/queries.ts         versionsKey, useVersions, useSaveVersion, useRestoreVersion
apps/web/lib/versions/transitions.ts     pure state transitions: markSaved, loadVersion, enterViewing, exitViewing, rebaseDraft
apps/web/lib/versions/relative-time.ts   relativeTime(iso, now)
apps/web/components/history/version-row.tsx      one row, collapsed or expanded (diff block + Restore / Export)
apps/web/components/history/history-list.tsx     list, newest first, footer caption
apps/web/components/history/viewing-banner.tsx   "Viewing v3 · read-only" pill
apps/web/components/dialogs/conflict-dialog.tsx  409 dialog (guard layout)
apps/web/app/dev/history/page.tsx        static showcase (own route; dev-gallery.tsx is NOT edited)
```

Track B (after Phase 4 merges; modifies claimed files): store factory, `editor-shell.tsx`, `control-panel/index.tsx`, `top-bar.tsx`, `apps/e2e/web/stack/versions.spec.ts`, docs.

---

# Track A — starts now

### Task 1: `lib/versions/diff.ts`

**Files:** Create `apps/web/lib/versions/diff.ts`, `apps/web/lib/versions/diff.test.ts`

**Interfaces — produces:**
```ts
computeDiff(current: EditorStateMap, draft: EditorStateMap): Diff
applyDiff(state: EditorStateMap, diff: Diff): EditorStateMap   // set, then remove; never mutates
isEmptyDiff(diff: Diff): boolean
statesBySeq(versions: readonly Version[]): EditorStateMap[]    // index = position in the ascending list
```

- [x] **Step 1: failing test**

```ts
import { describe, expect, it } from "vitest";
import type { Assignment, Version } from "@/lib/api-client";
import { applyDiff, computeDiff, isEmptyDiff, statesBySeq } from "./diff";

const a = (animationId: string, duration = "600ms"): Assignment => ({
  animationId, catalogVersion: "1.1.0", trigger: "load", params: { duration },
});

describe("computeDiff", () => {
  it("is empty for structurally equal states", () => {
    expect(isEmptyDiff(computeDiff({ h1: a("fade-in") }, { h1: a("fade-in") }))).toBe(true);
  });
  it("sets added and changed, removes dropped", () => {
    const diff = computeDiff(
      { h1: a("fade-in"), p: a("pulse"), img: a("zoom-in") },
      { h1: a("fade-in", "800ms"), img: a("zoom-in"), cta: a("pulse") },
    );
    expect(diff).toEqual({ set: { h1: a("fade-in", "800ms"), cta: a("pulse") }, remove: ["p"] });
  });
});

describe("applyDiff", () => {
  it("round-trips: applyDiff(a, computeDiff(a, b)) equals b", () => {
    const cases: [Record<string, Assignment>, Record<string, Assignment>][] = [
      [{}, { h1: a("fade-in") }],
      [{ h1: a("fade-in") }, {}],
      [{ h1: a("fade-in"), p: a("pulse") }, { p: a("pulse", "1s"), x: a("zoom-in") }],
    ];
    for (const [from, to] of cases) expect(applyDiff(from, computeDiff(from, to))).toEqual(to);
  });
  it("applies set before remove and does not mutate its input", () => {
    const state = { h1: a("fade-in") };
    expect(applyDiff(state, { set: { h1: a("pulse") }, remove: ["h1"] })).toEqual({});
    expect(state).toEqual({ h1: a("fade-in") });
  });
  it("rebases: my diff applied onto someone else's newer state keeps both", () => {
    const mine = computeDiff({ h1: a("fade-in") }, { h1: a("fade-in", "800ms") });
    expect(applyDiff({ h1: a("fade-in"), cta: a("pulse") }, mine)).toEqual({
      h1: a("fade-in", "800ms"), cta: a("pulse"),
    });
  });
});

describe("statesBySeq", () => {
  it("folds the ascending list into one state per version", () => {
    const v = (seq: number, diff: Version["diff"]): Version => ({
      id: `v${seq}`, projectId: "p", parentVersionId: seq ? `v${seq - 1}` : null, seq,
      label: "", catalogVersion: "1.1.0", diff, createdAt: "2026-09-18T00:00:00Z",
    });
    expect(
      statesBySeq([v(0, { set: {}, remove: [] }), v(1, { set: { h1: a("fade-in") }, remove: [] }), v(2, { set: {}, remove: ["h1"] })]),
    ).toEqual([{}, { h1: a("fade-in") }, {}]);
  });
});
```

- [x] **Step 2:** `pnpm --filter web test lib/versions/diff` → FAIL (module not found).
- [x] **Step 3: implement**

```ts
/**
 * The client half of "versions are diffs" (CLAUDE.md rule 9): what Save posts,
 * and the same fold the API's `stateAt()` performs, for the History rows and
 * for rebasing a draft after a 409. Pure — no store, no API.
 */
import type { Diff, EditorStateMap, Version } from "@/lib/api-client";
import { assignmentsEqual } from "@/lib/assignment";

export function computeDiff(current: EditorStateMap, draft: EditorStateMap): Diff {
  const set: Diff["set"] = {};
  for (const [vmId, assignment] of Object.entries(draft)) {
    if (!assignmentsEqual(current[vmId], assignment)) set[vmId] = assignment;
  }
  const remove = Object.keys(current).filter((vmId) => !(vmId in draft));
  return { set, remove };
}

/** `set` is applied, then `remove` — the order `openapi.yaml` gives `Diff`. */
export function applyDiff(state: EditorStateMap, diff: Diff): EditorStateMap {
  const next: EditorStateMap = { ...state, ...diff.set };
  for (const vmId of diff.remove) delete next[vmId];
  return next;
}

export function isEmptyDiff(diff: Diff): boolean {
  return Object.keys(diff.set).length === 0 && diff.remove.length === 0;
}

/** State at every version of an ascending list; `result[i]` belongs to `versions[i]`. */
export function statesBySeq(versions: readonly Version[]): EditorStateMap[] {
  const states: EditorStateMap[] = [];
  let state: EditorStateMap = {};
  for (const version of versions) {
    state = applyDiff(state, version.diff);
    states.push(state);
  }
  return states;
}
```

- [x] **Step 4:** same command → PASS.
- [x] **Step 5:** `git add apps/web/lib/versions/diff*.ts && git commit -m "feat(versions): client diff, apply and fold"`

### Task 2: `lib/versions/api.ts` — typed outcomes

**Files:** Create `apps/web/lib/versions/api.ts`, `apps/web/lib/versions/api.test.ts`

**Interfaces — consumes:** `apiClient` (`@/lib/api-client`), MSW server already listening in `vitest.setup.ts`, `createProject` from `@/mocks/db`.
**Produces:**
```ts
type WriteOutcome =
  | { kind: "saved"; version: Version }
  | { kind: "stale"; currentVersion: Version }              // 409
  | { kind: "rejected"; code: string; message: string }     // 400 / 413 / 422: the draft is kept, the dialog shows `message`
  | { kind: "busy"; retryAfterSeconds: number }             // 503 project_busy
  | { kind: "failed"; message: string };                    // 404, 5xx, network
saveVersion(projectId: string, body: CreateVersionRequest): Promise<WriteOutcome>
restoreVersion(projectId: string, versionId: string, label?: string): Promise<WriteOutcome>  // never "stale" today (DT-062)
fetchVersionState(projectId: string, versionId: string): Promise<EditorStateMap>  // throws on error, for useQuery / fetchQuery
fetchVersions(projectId: string): Promise<{ currentVersionId: string; versions: Version[] }>
```

- [x] **Step 1: failing test**

```ts
import { http, HttpResponse } from "msw";
import { describe, expect, it } from "vitest";
import { env } from "@/lib/env";
import { createProject } from "@/mocks/db";
import { server } from "@/mocks/server";
import { fetchVersions, fetchVersionState, restoreVersion, saveVersion } from "./api";

const fade = { animationId: "fade-in", catalogVersion: "1.1.0", trigger: "load" as const, params: {} };

function project() {
  const result = createProject("https://example.com/");
  if (result.status !== 201) throw new Error("mock createProject failed");
  return result.body;
}

describe("saveVersion", () => {
  it("saves, and the server state is the posted diff", async () => {
    const p = project();
    const outcome = await saveVersion(p.id, {
      parentVersionId: p.currentVersionId, catalogVersion: "1.1.0", label: "one",
      diff: { set: { "vm-1": fade }, remove: [] },
    });
    expect(outcome.kind).toBe("saved");
    if (outcome.kind !== "saved") return;
    expect(outcome.version.seq).toBe(1);
    expect(await fetchVersionState(p.id, outcome.version.id)).toEqual({ "vm-1": fade });
    expect((await fetchVersions(p.id)).currentVersionId).toBe(outcome.version.id);
  });

  it("reports a stale parent with the newer version", async () => {
    const p = project();
    const body = { parentVersionId: p.currentVersionId, catalogVersion: "1.1.0", diff: { set: { "vm-1": fade }, remove: [] } };
    const first = await saveVersion(p.id, body);
    const second = await saveVersion(p.id, body);
    expect(second).toEqual({ kind: "stale", currentVersion: first.kind === "saved" ? first.version : null });
  });

  it("maps 422 to rejected and 503 to busy with Retry-After", async () => {
    const p = project();
    const body = { parentVersionId: p.currentVersionId, catalogVersion: "1.1.0", diff: { set: { "vm-1": { ...fade, animationId: "nope" } }, remove: [] } };
    expect((await saveVersion(p.id, body)).kind).toBe("rejected");

    server.use(http.post(`${env.apiOrigin}/projects/:id/versions`, () =>
      HttpResponse.json({ code: "project_busy", message: "busy" }, { status: 503, headers: { "Retry-After": "2" } })));
    expect(await saveVersion(p.id, body)).toEqual({ kind: "busy", retryAfterSeconds: 2 });
  });
});

describe("restoreVersion", () => {
  it("creates a new current version whose state equals the target's", async () => {
    const p = project();
    const saved = await saveVersion(p.id, { parentVersionId: p.currentVersionId, catalogVersion: "1.1.0", diff: { set: { "vm-1": fade }, remove: [] } });
    const restored = await restoreVersion(p.id, p.currentVersionId);
    expect(saved.kind).toBe("saved");
    expect(restored.kind).toBe("saved");
    if (restored.kind !== "saved") return;
    expect(restored.version.seq).toBe(2);
    expect(await fetchVersionState(p.id, restored.version.id)).toEqual({});
  });
});
```

Before running: open `apps/web/mocks/handlers.ts` and confirm how it builds URLs (`api("/…")`); use the same origin expression in `server.use(...)` if it is not `env.apiOrigin`.

- [x] **Step 2:** `pnpm --filter web test lib/versions/api` → FAIL.
- [x] **Step 3: implement**

```ts
/**
 * The version endpoints as outcomes the UI can switch on, instead of
 * `{ data, error, response }` triples. No React here: the hooks in
 * `queries.ts` and the e2e-free unit tests both call these directly.
 */
import { apiClient, type ApiError, type CreateVersionRequest, type EditorStateMap, type StaleParentError, type Version } from "@/lib/api-client";

export type WriteOutcome =
  | { kind: "saved"; version: Version }
  | { kind: "stale"; currentVersion: Version }
  | { kind: "rejected"; code: string; message: string }
  | { kind: "busy"; retryAfterSeconds: number }
  | { kind: "failed"; message: string };

const DEFAULT_RETRY_AFTER_SECONDS = 1;

function outcome(data: Version | undefined, error: unknown, response: Response): WriteOutcome {
  if (data) return { kind: "saved", version: data };
  const body = (error ?? {}) as Partial<ApiError & StaleParentError>;
  const message = body.message ?? `Request failed (${response.status})`;
  if (response.status === 409 && body.currentVersion) return { kind: "stale", currentVersion: body.currentVersion };
  if (response.status === 503) {
    const seconds = Number(response.headers.get("Retry-After"));
    return { kind: "busy", retryAfterSeconds: Number.isFinite(seconds) && seconds > 0 ? seconds : DEFAULT_RETRY_AFTER_SECONDS };
  }
  if ([400, 413, 422].includes(response.status)) return { kind: "rejected", code: body.code ?? "rejected", message };
  return { kind: "failed", message };
}

async function guarded(call: () => Promise<WriteOutcome>): Promise<WriteOutcome> {
  try {
    return await call();
  } catch (cause) {
    return { kind: "failed", message: cause instanceof Error ? cause.message : "Network error" };
  }
}

export function saveVersion(projectId: string, body: CreateVersionRequest): Promise<WriteOutcome> {
  return guarded(async () => {
    const { data, error, response } = await apiClient.POST("/projects/{projectId}/versions", { params: { path: { projectId } }, body });
    return outcome(data, error, response);
  });
}

export function restoreVersion(projectId: string, versionId: string, label?: string): Promise<WriteOutcome> {
  return guarded(async () => {
    const { data, error, response } = await apiClient.POST("/projects/{projectId}/versions/{versionId}/restore", {
      params: { path: { projectId, versionId } },
      body: label === undefined ? {} : { label },
    });
    return outcome(data, error, response);
  });
}

export async function fetchVersionState(projectId: string, versionId: string): Promise<EditorStateMap> {
  const { data, error } = await apiClient.GET("/projects/{projectId}/versions/{versionId}/state", { params: { path: { projectId, versionId } } });
  if (!data) throw new Error((error as ApiError | undefined)?.message ?? "Could not load this version");
  return data.state;
}

export async function fetchVersions(projectId: string): Promise<{ currentVersionId: string; versions: Version[] }> {
  const { data, error } = await apiClient.GET("/projects/{projectId}/versions", { params: { path: { projectId } } });
  if (!data) throw new Error((error as ApiError | undefined)?.message ?? "Could not load version history");
  return data;
}
```

- [x] **Step 4:** PASS. Also `pnpm --filter web typecheck` (the path literals are checked against `schema.d.ts`).
- [x] **Step 5:** commit `feat(versions): typed outcomes for save, restore and state`.

### Task 3: `lib/versions/queries.ts` — hooks

**Files:** Create `apps/web/lib/versions/queries.ts`, `apps/web/lib/versions/queries.test.tsx`

**Produces:**
```ts
versionsKey(projectId): readonly ["project", string, "versions"]
versionStateKey(projectId, versionId): readonly ["project", string, "versions", string, "state"]
useVersions(projectId, enabled?: boolean)            // UseQueryResult<{ currentVersionId; versions }>
useSaveVersion(projectId)                            // UseMutationResult<WriteOutcome, never, CreateVersionRequest>
useRestoreVersion(projectId)                         // UseMutationResult<WriteOutcome, never, { versionId: string; label?: string }>
```
Both mutations invalidate `versionsKey` and `["project", projectId]` when the outcome is `saved` **or** `stale` (a stale list is exactly what a 409 proves).

- [x] **Step 1: failing test**

```tsx
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { createProject } from "@/mocks/db";
import { useSaveVersion, useVersions } from "./queries";

function wrapper() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

describe("useSaveVersion", () => {
  it("refreshes the versions list after a save", async () => {
    const created = createProject("https://example.com/");
    if (created.status !== 201) throw new Error("setup");
    const p = created.body;
    const { result } = renderHook(() => ({ list: useVersions(p.id), save: useSaveVersion(p.id) }), { wrapper: wrapper() });
    await waitFor(() => expect(result.current.list.data?.versions).toHaveLength(1));

    await act(async () => {
      await result.current.save.mutateAsync({
        parentVersionId: p.currentVersionId, catalogVersion: "1.1.0",
        diff: { set: { "vm-1": { animationId: "fade-in", catalogVersion: "1.1.0", trigger: "load", params: {} } }, remove: [] },
      });
    });
    await waitFor(() => expect(result.current.list.data?.versions).toHaveLength(2));
  });
});
```

- [x] **Step 2:** FAIL. **Step 3: implement**

```ts
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { CreateVersionRequest } from "@/lib/api-client";
import { fetchVersions, restoreVersion, saveVersion, type WriteOutcome } from "./api";

export const versionsKey = (projectId: string) => ["project", projectId, "versions"] as const;
export const versionStateKey = (projectId: string, versionId: string) =>
  ["project", projectId, "versions", versionId, "state"] as const;

export function useVersions(projectId: string, enabled = true) {
  return useQuery({ queryKey: versionsKey(projectId), queryFn: () => fetchVersions(projectId), enabled, retry: false });
}

function useRefreshOn(projectId: string) {
  const queryClient = useQueryClient();
  return async (outcome: WriteOutcome) => {
    if (outcome.kind !== "saved" && outcome.kind !== "stale") return;
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: versionsKey(projectId) }),
      queryClient.invalidateQueries({ queryKey: ["project", projectId], exact: true }),
    ]);
  };
}

export function useSaveVersion(projectId: string) {
  const refresh = useRefreshOn(projectId);
  return useMutation({ mutationFn: (body: CreateVersionRequest) => saveVersion(projectId, body), onSuccess: refresh });
}

export function useRestoreVersion(projectId: string) {
  const refresh = useRefreshOn(projectId);
  return useMutation({
    mutationFn: ({ versionId, label }: { versionId: string; label?: string }) => restoreVersion(projectId, versionId, label),
    onSuccess: refresh,
  });
}
```

- [x] **Step 4:** PASS. **Step 5:** commit `feat(versions): query hooks`.

### Task 4: `lib/versions/transitions.ts` — pure mode transitions

Written as pure functions over a structural slice so they need no store import; Track B calls them from inside the store factory's `set(...)`.

**Files:** Create `apps/web/lib/versions/transitions.ts`, `transitions.test.ts`

**Produces:**
```ts
type VersionSlice = {
  draftState: EditorStateMap; currentVersionState: EditorStateMap;
  mode: "editing" | "viewing"; currentVersionId: string | null; viewingVersionId: string | null;
};
initialVersionSlice: VersionSlice
isDirty(slice): boolean                                // false while viewing; else draft differs from current. The store's unsaved selectors delegate here (Task 8)
loadVersion(slice, versionId, state): VersionSlice     // project open, Back-to-current, after Restore, 409 Discard → editing, clean
markSaved(slice, version: Version): VersionSlice       // 201: current = draft, id moves; throws while viewing
enterViewing(slice, versionId, state): VersionSlice    // throws if the draft is dirty — the guard must run first
rebaseDraft(slice, newCurrentId, newCurrentState): VersionSlice  // 409 Rebase: my diff on top of theirs
```

- [x] **Step 1: failing test**

```ts
import { describe, expect, it } from "vitest";
import type { Assignment, Version } from "@/lib/api-client";
import { enterViewing, initialVersionSlice, loadVersion, markSaved, rebaseDraft } from "./transitions";

const a = (duration: string): Assignment => ({ animationId: "fade-in", catalogVersion: "1.1.0", trigger: "load", params: { duration } });
const version = (id: string): Version => ({ id, projectId: "p", parentVersionId: null, seq: 1, label: "", catalogVersion: "1.1.0", diff: { set: {}, remove: [] }, createdAt: "2026-09-18T00:00:00Z" });

describe("version transitions", () => {
  const clean = loadVersion(initialVersionSlice, "v1", { h1: a("600ms") });

  it("loadVersion lands in editing with draft == current", () => {
    expect(clean).toEqual({ draftState: { h1: a("600ms") }, currentVersionState: { h1: a("600ms") }, mode: "editing", currentVersionId: "v1", viewingVersionId: null });
  });
  it("markSaved promotes the draft", () => {
    const dirty = { ...clean, draftState: { h1: a("800ms") } };
    expect(markSaved(dirty, version("v2"))).toMatchObject({ currentVersionState: { h1: a("800ms") }, currentVersionId: "v2" });
  });
  it("enterViewing shows the old state but keeps current", () => {
    const viewing = enterViewing(clean, "v0", {});
    expect(viewing).toMatchObject({ mode: "viewing", viewingVersionId: "v0", draftState: {}, currentVersionState: { h1: a("600ms") }, currentVersionId: "v1" });
  });
  it("enterViewing refuses a dirty draft", () => {
    expect(() => enterViewing({ ...clean, draftState: {} }, "v0", {})).toThrow(/unsaved/);
  });
  it("rebaseDraft replays my change onto the newer version", () => {
    const dirty = { ...clean, draftState: { h1: a("800ms") } };
    expect(rebaseDraft(dirty, "v2", { h1: a("600ms"), cta: a("1s") })).toMatchObject({
      draftState: { h1: a("800ms"), cta: a("1s") }, currentVersionState: { h1: a("600ms"), cta: a("1s") }, currentVersionId: "v2", mode: "editing",
    });
  });
});
```

- [x] **Step 2:** FAIL. **Step 3: implement**

```ts
/**
 * The writers `currentVersionState` was waiting for (see the header of
 * `lib/store/index.ts`). Pure functions over a structural slice: the store
 * factory spreads their result into `set(...)`; nothing here imports the store.
 *
 * While viewing, `draftState` holds the *viewed* version's state (the iframe
 * always shows `draftState`) and `currentVersionState` still holds the real
 * current one, so "Back to v5" needs no fetch. `selectUnsaved` is therefore
 * meaningless while `mode === "viewing"`; callers check mode first.
 */
import type { EditorStateMap, Version } from "@/lib/api-client";
import { applyDiff, computeDiff, isEmptyDiff } from "./diff";

export type VersionSlice = {
  draftState: EditorStateMap;
  currentVersionState: EditorStateMap;
  mode: "editing" | "viewing";
  currentVersionId: string | null;
  viewingVersionId: string | null;
};

export const initialVersionSlice: VersionSlice = {
  draftState: {}, currentVersionState: {}, mode: "editing", currentVersionId: null, viewingVersionId: null,
};

export function loadVersion(_slice: VersionSlice, versionId: string, state: EditorStateMap): VersionSlice {
  return { draftState: { ...state }, currentVersionState: state, mode: "editing", currentVersionId: versionId, viewingVersionId: null };
}

export function markSaved(slice: VersionSlice, version: Version): VersionSlice {
  return { ...slice, currentVersionState: { ...slice.draftState }, currentVersionId: version.id };
}

export function enterViewing(slice: VersionSlice, versionId: string, state: EditorStateMap): VersionSlice {
  if (slice.mode === "editing" && !isEmptyDiff(computeDiff(slice.currentVersionState, slice.draftState))) {
    throw new Error("enterViewing with unsaved changes: run the guard first");
  }
  return { ...slice, draftState: { ...state }, mode: "viewing", viewingVersionId: versionId };
}

export function exitViewing(slice: VersionSlice): VersionSlice {
  return { ...slice, draftState: { ...slice.currentVersionState }, mode: "editing", viewingVersionId: null };
}

export function rebaseDraft(slice: VersionSlice, newCurrentId: string, newCurrentState: EditorStateMap): VersionSlice {
  const mine = computeDiff(slice.currentVersionState, slice.draftState);
  return { draftState: applyDiff(newCurrentState, mine), currentVersionState: newCurrentState, mode: "editing", currentVersionId: newCurrentId, viewingVersionId: null };
}
```

Add one test for `exitViewing` (viewing → `draftState` equals `currentVersionState`, `viewingVersionId` null) alongside the others before implementing.

- [x] **Step 4:** PASS. **Step 5:** commit `feat(versions): pure save/view/rebase transitions`.

### Task 5: History components + conflict dialog + `/dev/history`

**Files:** Create `apps/web/lib/versions/relative-time.ts` (+ test), `apps/web/components/history/version-row.tsx`, `history-list.tsx`, `viewing-banner.tsx` (+ one `.test.tsx` each), `apps/web/components/dialogs/conflict-dialog.tsx` (+ test), `apps/web/app/dev/history/page.tsx`.

Visual spec: `docs/design/README.md` line "History tab" and "Unsaved guard"; read `docs/design/ui_kit/Editor.jsx` for the row markup. Reuse `Button`, `ElementTag`, `Dialog`/`DialogContent`, and the sign colours from `save-dialog.tsx` (`text-vm-success` / `text-vm-warning` / `text-vm-danger`); if you need `ChangeRow`, export it from `save-dialog.tsx` — that file is not claimed by Phase 4 or 5.

**Produces (all presentational, no store, no queries):**
```ts
relativeTime(iso: string, now: Date): string   // "just now" <1m · "12m ago" · "2h ago" · weekday ("Mon") <7d · "Sep 3" otherwise

type VersionRowProps = {
  version: Version; rows: DiffRow[];            // rows from summariseDiff(parentState, state, getCatalogEntryAt)
  isCurrent: boolean; isViewing: boolean; now: Date;
  elementCount?: number;                        // v0 only: "Cloned — Mon · 42 elements"
  onView(versionId: string): void;
  onRestore(versionId: string): void; onExport?(versionId: string): void;   // Export stays disabled until Phase 7
  restoring?: boolean;
};
type HistoryListProps = { versions: Version[]; currentVersionId: string; viewingVersionId: string | null; now: Date; elementCount?: number }
  & Pick<VersionRowProps, "onView" | "onRestore" | "onExport" | "restoring">;   // computes rows via statesBySeq; renders newest first
type ViewingBannerProps = { viewingLabel: string; currentLabel: string; nextLabel: string; onRestore(): void; onBack(): void; restoring?: boolean };
type ConflictDialogProps = { open: boolean; theirs: Version; onRebase(): void; onDiscard(): void; onCancel(): void };
```

Behaviour to test (RTL, one `it` each):
- [x] `relativeTime`: the five buckets above with a fixed `now`.
- [x] `VersionRow`: renders `v5`, label, "Current" badge when `isCurrent`; clicking the row calls `onView(version.id)`; when `isViewing` it shows the diff rows ("+", "~", "−" with sr-only Added/Changed/Removed), a **Restore** button that calls `onRestore`, and **Export v5** disabled when `onExport` is absent; the current version's expanded row has no Restore.
- [x] `HistoryList`: three versions render newest first; v1 whose diff sets `h1` on an empty parent shows an `added` row; footer caption "Restoring creates a new version — v1 and v2 stay in the list." names the versions after the viewed one (omit the caption when nothing is being viewed).
- [x] `ViewingBanner`: text "Viewing v3 · read-only", buttons "Restore as v6" and "Back to v5" fire their callbacks; both disabled while `restoring`.
- [x] `ConflictDialog`: title "v6 was saved somewhere else", body names `theirs.label`; actions **Discard my changes** (red text, left) · **Keep editing** (secondary, `onCancel`) · **Apply my changes on top** (primary, `onRebase`). Same 380px layout as the guard dialog (handoff: "409 → reuse the guard dialog layout").
- [x] `app/dev/history/page.tsx`: a server page that `notFound()`s in production exactly like `app/dev/panel/page.tsx` does (copy its guard), rendering the list (nothing viewed), the list (v3 viewed), the banner, and the conflict dialog via `app/dev/static-dialog.tsx`. Do **not** add it to `dev-gallery.tsx`; Track B adds the link.

Each component: write its test, watch it fail, implement, pass, commit (`feat(history): <component>`). After the last one run `pnpm --filter web lint typecheck test`.

### Task 6: Track A close-out

- [x] `git diff --stat main...HEAD` — confirm every path is under `apps/web/lib/versions/`, `apps/web/components/history/`, `apps/web/components/dialogs/conflict-dialog*`, `apps/web/app/dev/history/`, `docs/plans/`, or is `save-dialog.tsx` (the `ChangeRow` export only). Anything else violates the global constraint: move it to Track B.
- [x] Run `pnpm gates` in the background; record the result in the worktree (it goes in the PR later).
- [x] Update `memory.md` on `main`: Track A done, Track B waiting on Phase 4.

---

# Track B — after `feat/4-bridge-integration` merges

### Task 7: Seam check, then rebase

Rebase onto `main`. Verify each assumption and fix this plan's text in the same commit where one fails:

- [x] The store is a factory `createEditorStore()` and still exposes `draftState`, `currentVersionState`, `mode`, `revertDraft`, `reset`, `selectUnsaved`, `selectDirtyVmIds`.
- [ ] The guard was lifted (DT-099): find where `UnsavedGuardDialog` is mounted, what opens it (`selectGuardOpen` / `resolveGuard` per the Phase 4 plan), and that `onSave` is an optional prop rendering disabled when absent.
- [x] The bridge client exposes a way to push a whole state (`state:load`) and the shell already mirrors `draftState` into the iframe. If the mirror is per-assignment `apply` only, Task 8 adds a `loadState(state)` call on the four transitions that replace the draft wholesale.
- [x] Whether Phase 5 Track A has merged (`panel-machine.ts` `auto` state, `CHANGE` event). If it has not, tell that session via memory.md before touching `store/index.ts` or `control-panel/index.tsx`.
- [x] `editor-shell.tsx` still has local `fetchVersions` + the `["project", id, "versions"]` query to replace with `useVersions`. **Hard rule:** that local query resolves to `Version[]` while `useVersions` resolves to `{ currentVersionId, versions }` under the *same key*. They share one cache entry, so if both are ever mounted together the editor throws on render (`data.find is not a function`). Delete the local `fetchVersions` + query in the **same commit** that first mounts `useVersions` or `HistoryList`; never land a partial wiring step.

#### Task 7 results (2026-09-19, against `main` dfb8b8b = Phase 4 PR #18 + Phase 5 Track A) — these override the task text below where they differ

- Store is a factory: `createEditorState: StateCreator<EditorStore>` in `lib/store/index.ts`. ✓ Phase 4 added `hoverVmId`, `elements`, `pendingSelectVmId`, `guardedVmId`, `requestSelect`, `resolveGuard`, `selectElementDirty`, `selectGuardOpen`. `setMode` still exists.
- **No bridge work is needed.** `lib/bridge/client.ts` subscribes to the store and mirrors every `draftState` change (per element, or one `state:load` above `BULK_APPLY_LIMIT`), so replacing `draftState` wholesale is all viewing / restore / rebase have to do. Ignore the "add a `loadState(state)` call" fallback.
- **The guard was not lifted (DT-099 still open).** Two mountings: the tab guard inside `control-panel/index.tsx` (local `pendingTab`, Discard = `revertDraft()`), and `components/editor/element-switch-guard.tsx` in the shell (`resolveGuard`). Both take `onSave?: () => void | Promise<void>` and treat a resolved promise as "saved"; a rejection keeps the guard open. So the save flow exposes `requestSave(): Promise<void>` — resolves after a 201, rejects when the Save dialog is cancelled or the save fails.
- **Phase 5 Track B is editing `store/index.ts`, `control-panel/{idle,selected,index}.tsx` and the shell concurrently.** Keep shared-file edits thin: the new state/actions live in a NEW `lib/store/version-slice.ts` spread into `createEditorState`; mode-awareness is ONE early return in `selectDirtyVmIds`; do not touch `selectElementDirty`. Phase 5's plan D2: any writer that replaces `currentVersionState` must clear its `generated` + `lastRun` — add that on rebase if Phase 5 lands first (memory.md notice 2026-09-19).
- `editor-shell.tsx` still has the local `fetchVersions` + same-key query. ✓ Same-commit rule applies (Task 9).
- Read-only while viewing is enforced in the store: `requestSelect` and every draft writer return early when `mode === "viewing"`.

### Task 8: Store wiring

- [x] Done — see `## Status (2026-09-20)` above.

**Files:** Modify `apps/web/lib/store/index.ts` (+ test).

Add `currentVersionId` and `viewingVersionId` to `EditorState` (initial `null`) and four actions that delegate to Task 4: `loadVersion(versionId, state)`, `markSaved(version)`, `enterViewing(versionId, state)`, `exitViewing()`, `rebaseDraft(newCurrentId, state)`. Each is `set((s) => ({ ...transitions.fn(s, …), panel: <see below> }))`. `loadVersion`, `enterViewing`, `exitViewing` and `rebaseDraft` also send the panel through `REVERT` exactly as `revertDraft` does today, so a selected element lands on `tuning` or `selected` according to the new `draftState`. Remove `setMode` if nothing else calls it (grep first). **Viewing is never "unsaved":** while viewing, `draftState` holds the *viewed* state, so a raw draft-vs-current comparison is true for the whole viewing session. `selectUnsaved`, `selectDirtyVmIds`, `selectDirtyVmIdCount` and `selectGuardedVmId` must delegate to `isDirty(slice)` from `lib/versions/transitions.ts` (false while `mode === "viewing"`); `revertDraft` is a no-op while viewing; `markSaved` throws while viewing (Track A), so Save can never become a backdoor restore. Every draft writer (`setDraftAssignment`, `updateDraftParam`, `removeDraftAssignment`, `dispatchPanel` `PICK`) returns `state` unchanged while `mode === "viewing"` — the store, not just disabled controls, is what makes viewing read-only.

Tests (add to `index.test.ts`): each action's effect on state; `updateDraftParam` is a no-op while viewing; `selectSelectedVmId` survives `enterViewing`; `reset()` clears both new ids.

### Task 9: Save flow

- [x] Done — see `## Status (2026-09-20)` above.

**Files:** Create `apps/web/components/editor/use-save-flow.ts` (+ test). Modify `editor-shell.tsx`, `top-bar.tsx` (enable Save), the guard mounting (pass `onSave`).

`useSaveFlow(projectId)` returns `{ open(), dialogProps, conflictProps, error }`. `open()` computes `computeDiff(currentVersionState, draftState)` and `summariseDiff(...)` for the dialog. Confirm → `useSaveVersion().mutateAsync({ parentVersionId: currentVersionId, catalogVersion: CURRENT_CATALOG_VERSION, label, diff })`, then by outcome: `saved` → `markSaved(version)`, close, toast `Saved v<seq>`, run the guard's pending action if Save came from the guard; `stale` → close Save dialog, open `ConflictDialog` with `currentVersion`; `rejected` → keep the dialog open with `message` inline; `busy` → wait `retryAfterSeconds` once and retry, then surface as `failed`; `failed` → inline message, draft untouched. Conflict → **Rebase**: `fetchVersionState(theirs.id)` → `rebaseDraft(theirs.id, state)` → reopen the Save dialog (the user confirms the second save; never auto-retry a write they have not seen). **Discard**: `fetchVersionState` → `loadVersion`. On project open: `useVersions` + `fetchVersionState(currentVersionId)` → `loadVersion`, replacing today's empty `currentVersionState`.

Tests: MSW-backed, one per outcome above; the 409 case uses a second `saveVersion` call in the test as "the other tab".

### Task 10: History tab, viewing mode, restore

- [x] Done — see `## Status (2026-09-20)` above.

**Files:** Modify `control-panel/index.tsx` (mount `HistoryList` in the existing `TabsContent value="history"`), `editor-shell.tsx` (banner + dim overlay over the preview sheet, `pointer-events: none` on the iframe wrapper while viewing), `app/dev/dev-gallery.tsx` (link to `/dev/history`).

View: guard first if dirty (existing tab guard already covers opening History) → `queryClient.fetchQuery({ queryKey: versionStateKey(...), queryFn, staleTime: Infinity })` (a version's state is immutable) → `enterViewing`. Clicking the current version while viewing, or **Back to v5**, → `exitViewing`. **Restore** (row or banner) → `useRestoreVersion` → on `saved`: `fetchVersionState(new.id)` → `loadVersion`, toast `Restored v3 as v6`, tab stays on History. Top bar while viewing: the unsaved dot, **Save** and **Cancel** are hidden (`docs/user_flow.md` mode table: "Controls disabled · Save hidden"); the Esc-deselect gate reads the same mode-aware selector. The History tab renders an error state with a **Retry** button when `useVersions` fails (`retry: false`, same pattern as the editor's project-load error screen). Animate tab controls read `mode` and render disabled while viewing; `element:select` from the bridge is ignored while viewing. The protocol's reserved `mode` message stays unimplemented; log a DT if the overlay proves leaky in e2e.

Tests: RTL for the tab (view → banner → back; restore → list grows, row v(n+1) current); store no-op test from Task 8 covers the read-only guarantee.

### Task 11: Stack e2e — the exit criteria

- [x] Done — see `## Status (2026-09-20)` above.

**Files:** Create `apps/e2e/web/stack/versions.spec.ts`. Follow `apps/e2e/web/stack/clone.spec.ts` for project creation and `stack/env.ts` origins; scope every assertion to the project the test created (the DB is never cleaned within a run).

One spec, steps: clone `marketing.html` → click an element, pick an animation → assert `GET /versions` still has 1 entry (no version until Save) → save five times with a param change between each (v1..v5) → open History, click v2 → read the element's inline `animation-duration` inside the iframe and compare with `GET /versions/{v2}/state` → Restore → list shows v6, `GET state(v6)` deep-equals `state(v2)`. Second test: open the project in two pages of one context, save in page B, then save in page A → conflict dialog appears → **Apply my changes on top** → Save → version count is 3 and state contains both changes.

### Task 12: Docs, deferred log, PR

- [ ] Close DT-100; note on DT-099 that History/Restore triggers are covered and Export remains (Phase 7). Log new DTs: conflict dialog has no Claude Design mock (P3, later); `busy` retry is single-shot (P3); reserved bridge `mode` message unused (P3) — only if still true.
- [ ] `docs/build_plan.md` Phase 6: mark the rebase decision as implemented ("apply my diff on top, user re-confirms Save").
- [ ] `pnpm gates` (background) → `screenshot-runner` (History tab, viewing, conflict dialog) → `code-reviewer` → fix blockers → `test-runner` on the final commit → open PR with the template → memory.md.

## Self-review

- Spec coverage: Save explicit + enabled only when dirty → Task 9 (+ existing `selectUnsaved`); 409 rebase/discard → Tasks 1, 4, 9; viewing read-only + guard first → Tasks 4, 8, 10; Restore appends → Tasks 2, 10; labels prefilled → existing `summariseDiff`, Task 9; base page immutable → nothing to build; exit criteria → Task 11.
- Known softness, by design (same as the Phase 4 plan): Tasks 8–11 name files Phase 4 and Phase 5 are rewriting. Task 7 re-verifies them; step-level code for Track B is finalised there rather than guessed against unmerged branches. Track A is fully specified.
- Type consistency: `WriteOutcome`, `VersionSlice`, `versionsKey`, `versionStateKey`, `computeDiff`/`applyDiff`/`statesBySeq` are used under the same names in Tasks 3, 8, 9, 10.
