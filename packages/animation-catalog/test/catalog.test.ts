import { describe, expect, it } from "vitest";
import { parse } from "css-tree";
import { CATALOGS, CATALOG_VERSIONS, CURRENT_VERSION, getEntry, keyframesName } from "../src/index.js";

const numericTypes = new Set(["length", "number", "angle", "percentage", "duration"]);

function magnitude(v: string): number {
  const m = /^-?\d*\.?\d+/.exec(v.trim());
  if (!m) throw new Error(`not numeric: ${v}`);
  return Number(m[0]);
}

describe("animation catalog", () => {
  it("exposes at least one version and current is published", () => {
    expect(CATALOG_VERSIONS.length).toBeGreaterThan(0);
    expect(CATALOG_VERSIONS).toContain(CURRENT_VERSION);
    expect(CATALOGS[CURRENT_VERSION].version).toBe(CURRENT_VERSION);
  });

  for (const version of CATALOG_VERSIONS) {
    describe(`version ${version}`, () => {
      const catalog = CATALOGS[version];

      it("has unique ids", () => {
        const ids = catalog.entries.map((e) => e.id);
        expect(new Set(ids).size).toBe(ids.length);
      });

      for (const entry of catalog.entries) {
        describe(entry.id, () => {
          it("keyframes parse as CSS with every custom property substituted", () => {
            let body = entry.keyframes;
            for (const p of entry.params) if (p.cssVar) body = body.replaceAll(`var(${p.cssVar})`, p.default);
            expect(body).not.toContain("var(--vm-");
            const css = `@keyframes ${keyframesName(entry.id, version)} { ${body} }`;
            const errors: string[] = [];
            parse(css, { onParseError: (e) => errors.push(e.message) });
            expect(errors).toEqual([]);
          });

          it("baseStyles parse as declarations", () => {
            if (!entry.baseStyles) return;
            let decl = entry.baseStyles;
            for (const p of entry.params) if (p.cssVar) decl = decl.replaceAll(`var(${p.cssVar})`, p.default);
            expect(decl).not.toContain("var(--vm-");
            const errors: string[] = [];
            parse(decl, { context: "declarationList", onParseError: (e) => errors.push(e.message) });
            expect(errors).toEqual([]);
          });

          it("every param default lies within min/max", () => {
            for (const p of entry.params) {
              if (!numericTypes.has(p.type)) continue;
              const d = magnitude(p.default);
              if (p.min !== undefined) expect(d, `${p.key} default < min`).toBeGreaterThanOrEqual(magnitude(p.min));
              if (p.max !== undefined) expect(d, `${p.key} default > max`).toBeLessThanOrEqual(magnitude(p.max));
            }
          });

          it("always exposes duration and easing", () => {
            const keys = entry.params.map((p) => p.key);
            expect(keys).toContain("duration");
            expect(keys).toContain("easing");
          });
        });
      }
    });
  }

  it("getEntry resolves a known id and rejects unknown", () => {
    expect(getEntry(CURRENT_VERSION, "fade-in-up")?.name).toBe("Fade In Up");
    expect(getEntry(CURRENT_VERSION, "does-not-exist")).toBeUndefined();
    expect(getEntry("9.9.9", "fade-in-up")).toBeUndefined();
  });

  it("keyframesName embeds the full catalog version", () => {
    expect(keyframesName("pulse", "1.4.2")).toBe("vm-pulse-v1-4-2");
    expect(keyframesName("pulse", "2.0.0")).toBe("vm-pulse-v2-0-0");
    expect(keyframesName("fade-in-up", "1.1.0")).toBe("vm-fade-in-up-v1-1-0");
  });

  it("keyframesName throws on a version that is not strict MAJOR.MINOR.PATCH", () => {
    expect(() => keyframesName("pulse", "1.4")).toThrow();
    expect(() => keyframesName("pulse", "1.4.2-beta")).toThrow();
    expect(() => keyframesName("pulse", "v1.4.2")).toThrow();
    expect(() => keyframesName("pulse", "")).toThrow();
  });

  it("keyframesName is injective across versions that would collide under major-only naming", () => {
    const names = new Set([
      keyframesName("pulse", "1.1.0"),
      keyframesName("pulse", "11.0.0"),
      keyframesName("pulse", "1.10.0"),
    ]);
    expect(names.size).toBe(3);
  });
});
