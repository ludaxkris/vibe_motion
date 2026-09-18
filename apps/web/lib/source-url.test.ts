import { describe, expect, it } from "vitest";

import { hostAndPath, normalizeSourceUrl, stripHttpsScheme } from "./source-url";

describe("stripHttpsScheme", () => {
  it("removes the scheme the field's prefix already shows", () => {
    expect(stripHttpsScheme("https://nimbus.app/pricing")).toBe("nimbus.app/pricing");
  });

  it("ignores the case the scheme was pasted in", () => {
    expect(stripHttpsScheme("HTTPS://nimbus.app")).toBe("nimbus.app");
  });

  it("leaves http:// alone so it stays possible to type", () => {
    expect(stripHttpsScheme("http://nimbus.app")).toBe("http://nimbus.app");
  });

  it("leaves a scheme-less value alone", () => {
    expect(stripHttpsScheme("nimbus.app/pricing")).toBe("nimbus.app/pricing");
  });

  it("does not strip a scheme from the middle of the value", () => {
    expect(stripHttpsScheme("nimbus.app/?to=https://elsewhere.test")).toBe(
      "nimbus.app/?to=https://elsewhere.test",
    );
  });
});

describe("normalizeSourceUrl", () => {
  it("adds the prefix's scheme to a bare host", () => {
    expect(normalizeSourceUrl("nimbus.app/pricing")).toBe("https://nimbus.app/pricing");
  });

  it("keeps an explicitly typed http:// URL on http", () => {
    expect(normalizeSourceUrl("http://nimbus.app")).toBe("http://nimbus.app/");
  });

  it("keeps an explicitly typed https:// URL", () => {
    expect(normalizeSourceUrl("https://nimbus.app")).toBe("https://nimbus.app/");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeSourceUrl("  nimbus.app  ")).toBe("https://nimbus.app/");
  });

  it.each([
    ["", "empty"],
    ["   ", "blank"],
    ["not a url with spaces!!", "spaces"],
    ["ftp://nimbus.app", "non-http(s) scheme"],
    ["javascript:alert(1)", "javascript:"],
  ])("rejects %j (%s)", (value) => {
    expect(normalizeSourceUrl(value)).toBeNull();
  });
});

describe("hostAndPath", () => {
  it("renders host plus path, the way the handoff labels a clone", () => {
    expect(hostAndPath("https://nimbus.app/pricing")).toBe("nimbus.app/pricing");
  });

  it("drops a bare trailing slash", () => {
    expect(hostAndPath("https://nimbus.app/")).toBe("nimbus.app");
  });

  it("keeps the query string", () => {
    expect(hostAndPath("https://nimbus.app/pricing?plan=pro")).toBe("nimbus.app/pricing?plan=pro");
  });

  it("falls back to the raw value when it cannot be parsed", () => {
    expect(hostAndPath("nimbus.app")).toBe("nimbus.app");
  });
});
