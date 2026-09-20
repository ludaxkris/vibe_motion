"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import type { RunFailure, RunOutcome } from "@/lib/agent/run";

type AgentRunState = { busy: boolean; error: RunFailure | null; errorScope: unknown };

const IDLE: AgentRunState = { busy: false, error: null, errorScope: null };

/**
 * Busy / error state for the panel's agent runs. It lives here, not in the
 * store (Phase 5 plan, Task 0 result item 5): it describes a button, not the
 * draft.
 *
 * One run at a time, across every button that starts one: a second `run()`
 * while one is in flight does nothing and returns `undefined`, so a double
 * click runs once. The last failure is kept until the next run starts, along
 * with the `scope` it was started under — the caller passes whatever
 * identifies "where the button was" (the panel state object) and shows the
 * message only while that is still where the designer is.
 */
export function useAgentRun(): {
  busy: boolean;
  error: RunFailure | null;
  errorScope: unknown;
  run: (fn: () => Promise<RunOutcome>, scope?: unknown) => Promise<RunOutcome> | undefined;
} {
  const [state, setState] = useState<AgentRunState>(IDLE);
  // Refs, because two clicks in one tick both see the same rendered `busy`.
  const inFlight = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback((fn: () => Promise<RunOutcome>, scope: unknown = null) => {
    if (inFlight.current) return undefined;
    inFlight.current = true;
    setState({ busy: true, error: null, errorScope: null });

    const settled = (async (): Promise<RunOutcome> => {
      try {
        return await fn();
      } catch {
        // `lib/agent/run` never rejects; a caller's own wrapper might.
        return { ok: false, reason: "agent-failed" };
      }
    })();

    return settled.then((outcome) => {
      inFlight.current = false;
      if (mounted.current) {
        setState(
          outcome.ok ? IDLE : { busy: false, error: outcome.reason, errorScope: scope },
        );
      }
      return outcome;
    });
  }, []);

  return { ...state, run };
}
