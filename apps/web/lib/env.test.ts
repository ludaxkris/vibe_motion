import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `env` is a module-level const, so each case re-imports the module with the
 * variables it wants: that is exactly how the real build reads them (once, at
 * module evaluation).
 */
async function loadEnv() {
  vi.resetModules();
  const mod = await import("./env");
  return mod.env;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("env.apiMocking", () => {
  it("is on when the flag is enabled outside a production build", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCKING", "enabled");
    vi.stubEnv("NODE_ENV", "test");

    expect((await loadEnv()).apiMocking).toBe(true);
  });

  it("stays off in a production build even when the flag is enabled", async () => {
    // The mock worker answers every API call from memory; shipping it to
    // production would silently replace the real API.
    vi.stubEnv("NEXT_PUBLIC_API_MOCKING", "enabled");
    vi.stubEnv("NODE_ENV", "production");

    expect((await loadEnv()).apiMocking).toBe(false);
  });

  it("is off when the flag is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_MOCKING", undefined);
    vi.stubEnv("NODE_ENV", "development");

    expect((await loadEnv()).apiMocking).toBe(false);
  });
});

describe("env.apiOrigin", () => {
  it("falls back to the local API when NEXT_PUBLIC_API_ORIGIN is unset", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_ORIGIN", undefined);

    expect((await loadEnv()).apiOrigin).toBe("http://localhost:8080");
  });
});
