import { describe, expect, it } from "vitest";

import { siblingLoopbackOrigin } from "./loopback";

describe("siblingLoopbackOrigin", () => {
  it("answers 127.0.0.1 for a localhost shell, keeping protocol and port", () => {
    expect(
      siblingLoopbackOrigin({ protocol: "http:", hostname: "localhost", port: "3000" }),
    ).toBe("http://127.0.0.1:3000");
  });

  it("answers localhost for a 127.0.0.1 shell — the swap goes both ways", () => {
    expect(
      siblingLoopbackOrigin({ protocol: "http:", hostname: "127.0.0.1", port: "3000" }),
    ).toBe("http://localhost:3000");
  });

  it("carries whatever port the dev server actually got, not a hardcoded 3000", () => {
    expect(
      siblingLoopbackOrigin({ protocol: "http:", hostname: "localhost", port: "4711" }),
    ).toBe("http://127.0.0.1:4711");
  });

  it("omits the port when there is none", () => {
    expect(siblingLoopbackOrigin({ protocol: "https:", hostname: "localhost", port: "" })).toBe(
      "https://127.0.0.1",
    );
  });

  it("has no sibling for a host that is not one of the two loopback spellings", () => {
    expect(siblingLoopbackOrigin({ protocol: "http:", hostname: "web", port: "3000" })).toBeNull();
    expect(siblingLoopbackOrigin({ protocol: "http:", hostname: "::1", port: "3000" })).toBeNull();
  });
});
