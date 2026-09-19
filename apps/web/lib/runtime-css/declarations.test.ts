import { describe, expect, it } from "vitest";

import { parseDeclarations } from "./declarations";

describe("parseDeclarations", () => {
  it("reads a plain declaration list", () => {
    expect(parseDeclarations("transform-origin: center; backface-visibility: hidden;")).toEqual({
      "transform-origin": "center",
      "backface-visibility": "hidden",
    });
  });

  it("tolerates a missing trailing semicolon and stray whitespace", () => {
    expect(parseDeclarations("  transform-origin : center bottom  ")).toEqual({
      "transform-origin": "center bottom",
    });
  });

  it("keeps commas and semicolons that sit inside parentheses", () => {
    expect(
      parseDeclarations(
        "background-image: linear-gradient(100deg, transparent 30%, var(--vm-color) 50%, transparent 70%); background-size: 200% 100%;",
      ),
    ).toEqual({
      "background-image":
        "linear-gradient(100deg, transparent 30%, var(--vm-color) 50%, transparent 70%)",
      "background-size": "200% 100%",
    });
  });

  it("does not split on a colon or semicolon inside a url()", () => {
    expect(parseDeclarations("background: url(data:image/gif;base64,AAA) no-repeat")).toEqual({
      background: "url(data:image/gif;base64,AAA) no-repeat",
    });
  });

  it("does not split inside quotes", () => {
    expect(parseDeclarations(`content: "a; b: c"; display: block`)).toEqual({
      content: `"a; b: c"`,
      display: "block",
    });
  });

  it("keeps an escaped quote inside a quoted string", () => {
    expect(parseDeclarations(`content: "a\\"; b"`)).toEqual({ content: `"a\\"; b"` });
  });

  it("keeps custom properties as written", () => {
    expect(parseDeclarations("--vm-shadow: 0 1px 2px rgba(0, 0, 0, 0.2)")).toEqual({
      "--vm-shadow": "0 1px 2px rgba(0, 0, 0, 0.2)",
    });
  });

  it("drops empty fragments and anything without a value", () => {
    expect(parseDeclarations(";; display: block ;; color: ; ;")).toEqual({ display: "block" });
  });

  it("is empty for empty input", () => {
    expect(parseDeclarations("")).toEqual({});
    expect(parseDeclarations("   ")).toEqual({});
  });

  it("lets a later declaration win, as a browser would", () => {
    expect(parseDeclarations("color: red; color: blue")).toEqual({ color: "blue" });
  });
});
