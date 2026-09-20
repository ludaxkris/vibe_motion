import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { RunOutcome } from "@/lib/agent/run";

import { useAgentRun } from "./use-agent-run";

function deferred() {
  let resolve!: (outcome: RunOutcome) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<RunOutcome>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useAgentRun", () => {
  it("starts idle with no error", () => {
    const { result } = renderHook(() => useAgentRun());

    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("is busy while the run is pending and idle again after it", async () => {
    const { result } = renderHook(() => useAgentRun());
    const d = deferred();

    act(() => {
      void result.current.run(() => d.promise);
    });
    expect(result.current.busy).toBe(true);

    await act(async () => d.resolve({ ok: true, count: 3 }));
    expect(result.current.busy).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("runs once on a double click: a second call while busy is ignored", async () => {
    const { result } = renderHook(() => useAgentRun());
    const d = deferred();
    const fn = vi.fn(() => d.promise);

    let second: Promise<RunOutcome> | undefined;
    act(() => {
      void result.current.run(fn);
      second = result.current.run(fn);
    });

    expect(fn).toHaveBeenCalledOnce();
    expect(second).toBeUndefined();
    await act(async () => d.resolve({ ok: true, count: 1 }));
  });

  it("keeps the last failure, with the scope it was run under, until the next run starts", async () => {
    const { result } = renderHook(() => useAgentRun());
    const scope = { status: "idle" };

    await act(async () => {
      await result.current.run(async () => ({ ok: false, reason: "no-targets" }), scope);
    });
    expect(result.current.error).toBe("no-targets");
    expect(result.current.errorScope).toBe(scope);

    const d = deferred();
    act(() => {
      void result.current.run(() => d.promise);
    });
    expect(result.current.error).toBeNull();

    await act(async () => d.resolve({ ok: true, count: 1 }));
    expect(result.current.error).toBeNull();
  });

  it("reads a run that throws as agent-failed instead of leaking the rejection", async () => {
    const { result } = renderHook(() => useAgentRun());

    await act(async () => {
      await result.current.run(() => Promise.reject(new Error("boom")));
    });

    expect(result.current.error).toBe("agent-failed");
    expect(result.current.busy).toBe(false);
  });

  it("does not update state after unmount", async () => {
    const onError = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { result, unmount } = renderHook(() => useAgentRun());
      const d = deferred();
      act(() => {
        void result.current.run(() => d.promise);
      });

      unmount();
      await act(async () => d.resolve({ ok: false, reason: "query-failed" }));

      expect(result.current.busy).toBe(true); // the last rendered value; nothing re-rendered
      expect(onError).not.toHaveBeenCalled();
    } finally {
      onError.mockRestore();
    }
  });
});
