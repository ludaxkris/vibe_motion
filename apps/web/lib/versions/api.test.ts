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
