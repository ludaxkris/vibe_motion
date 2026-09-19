import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** The worker start `MockProvider` waits on; each test says how it settles. */
const startWorker = vi.fn<() => Promise<unknown>>();

/**
 * `vi.resetModules()` per test so the provider picks up this test's `env`,
 * and `./browser` is stubbed because the real one registers a service worker
 * jsdom has none of.
 */
async function renderProvider(apiMocking: boolean) {
  vi.doMock("@/lib/env", () => ({ env: { apiMocking } }));
  vi.doMock("./browser", () => ({ startWorker }));
  const { MockProvider } = await import("./MockProvider");
  return render(
    <MockProvider>
      <p>the app</p>
    </MockProvider>,
  );
}

beforeEach(() => {
  vi.resetModules();
  startWorker.mockReset();
});

afterEach(() => {
  vi.doUnmock("@/lib/env");
  vi.doUnmock("./browser");
  vi.restoreAllMocks();
});

describe("MockProvider", () => {
  it("renders the app once the worker is intercepting", async () => {
    startWorker.mockResolvedValue(undefined);

    await renderProvider(true);

    await waitFor(() => expect(screen.getByText("the app")).toBeInTheDocument());
  });

  it("renders the app anyway when the worker cannot start, and says why once", async () => {
    // Otherwise a registration failure is a permanently blank page plus an
    // unhandled rejection — the app is still usable against a real API.
    const error = new Error("no service worker here");
    startWorker.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    await renderProvider(true);

    await waitFor(() => expect(screen.getByText("the app")).toBeInTheDocument());
    expect(consoleError).toHaveBeenCalledOnce();
    expect(consoleError.mock.calls[0]).toContain(error);
  });

  it("does not start a worker at all when mocking is off", async () => {
    await renderProvider(false);

    expect(screen.getByText("the app")).toBeInTheDocument();
    expect(startWorker).not.toHaveBeenCalled();
  });
});
