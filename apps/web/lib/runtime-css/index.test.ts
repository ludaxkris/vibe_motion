import { CATALOGS, CATALOG_VERSIONS, CURRENT_VERSION, keyframesName } from "animation-catalog";
import type { CatalogEntry } from "animation-catalog";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import {
  assignmentStyle,
  baseStyleDeclarations,
  inlineStyle,
  keyframesCss,
  resolveParams,
  runtimeStylesheet,
} from "@/lib/runtime-css";
import { parseDeclarations } from "@/lib/runtime-css/declarations";

/** Every (entry, version) pair across every published catalog version. */
const allEntries: Array<{ version: string; entry: CatalogEntry }> = CATALOG_VERSIONS.flatMap(
  (version) => CATALOGS[version].entries.map((entry) => ({ version, entry })),
);

const [{ version: sampleVersion, entry: sampleEntry }] = allEntries;

describe("resolveParams", () => {
  it("maps every catalog param to its default when no params are given", () => {
    const resolved = resolveParams(sampleEntry);
    for (const param of sampleEntry.params) {
      expect(resolved[param.key]).toBe(param.default);
    }
    expect(Object.keys(resolved)).toHaveLength(sampleEntry.params.length);
  });

  it("uses the given value over the default for a known key", () => {
    const [firstParam] = sampleEntry.params;
    const resolved = resolveParams(sampleEntry, { [firstParam.key]: "OVERRIDDEN" });
    expect(resolved[firstParam.key]).toBe("OVERRIDDEN");
  });

  it("drops keys that are not declared on the catalog entry", () => {
    const resolved = resolveParams(sampleEntry, { notARealParamKey: "x" });
    expect(resolved).not.toHaveProperty("notARealParamKey");
  });
});

describe("keyframesCss", () => {
  it.each(allEntries)("wraps $entry.id ($version) as a valid @keyframes rule", ({ version, entry }) => {
    const css = keyframesCss(entry, version);
    expect(css.startsWith(`@keyframes ${keyframesName(entry.id, version)} {`)).toBe(true);

    const root = postcss.parse(css);
    expect(root.nodes).toHaveLength(1);
    const [atRule] = root.nodes;
    expect(atRule.type).toBe("atrule");
    if (atRule.type === "atrule") {
      expect(atRule.name).toBe("keyframes");
      expect(atRule.params).toBe(keyframesName(entry.id, version));
    }
  });

  it("uses a vm-prefixed keyframes name", () => {
    const css = keyframesCss(sampleEntry, sampleVersion);
    expect(css.startsWith(`@keyframes ${keyframesName(sampleEntry.id, sampleVersion)} {`)).toBe(true);
    expect(keyframesName(sampleEntry.id, sampleVersion)).toMatch(/^vm-/);
  });
});

describe("baseStyleDeclarations", () => {
  it.each(allEntries)(
    "parses every declaration $entry.id ($version) declares in baseStyles",
    ({ entry }) => {
      const declarations = baseStyleDeclarations(entry);

      if (!entry.baseStyles) {
        expect(declarations).toEqual({});
        return;
      }

      // Every `prop: value;` fragment the catalog wrote is present, and the
      // values are carried through verbatim (commas inside `linear-gradient()`
      // and `var()` references included).
      const fragments = entry.baseStyles.split(";").filter((part) => part.trim());
      expect(Object.keys(declarations)).toHaveLength(fragments.length);
      for (const fragment of fragments) {
        const colon = fragment.indexOf(":");
        expect(declarations[fragment.slice(0, colon).trim()]).toBe(
          fragment.slice(colon + 1).trim(),
        );
      }
    },
  );

  it("carries shimmer's background-image, which its keyframes have nothing to slide without", () => {
    const entry = CATALOGS[CURRENT_VERSION].entries.find((e) => e.id === "shimmer")!;
    const declarations = baseStyleDeclarations(entry);

    expect(declarations["background-image"]).toContain("linear-gradient(");
    expect(declarations["background-size"]).toBe("200% 100%");
  });

  it("is empty for an entry with no baseStyles", () => {
    const entry = CATALOGS[CURRENT_VERSION].entries.find((e) => e.id === "fade-in")!;
    expect(entry.baseStyles).toBeUndefined();
    expect(baseStyleDeclarations(entry)).toEqual({});
  });
});

describe("assignmentStyle", () => {
  it.each(allEntries)(
    "covers every param of $entry.id ($version) with a standard property or a --vm- custom property",
    ({ version, entry }) => {
      const style = assignmentStyle(entry, version);

      expect(style["animation-name"]).toBe(keyframesName(entry.id, version));

      // animation-name, one declaration per catalog param, plus whatever the
      // entry's baseStyles declare.
      expect(Object.keys(style)).toHaveLength(
        1 + entry.params.length + Object.keys(baseStyleDeclarations(entry)).length,
      );

      for (const param of entry.params) {
        if (param.cssVar) {
          expect(style[param.cssVar]).toBe(param.default);
          expect(param.cssVar.startsWith("--vm-")).toBe(true);
        } else {
          // Standard keys (duration, delay, easing, iteration, direction, ...) must
          // resolve to a real animation-* longhand, never silently disappear.
          const standardEntries = Object.entries(style).filter(
            ([, value]) => value === param.default,
          );
          expect(standardEntries.length).toBeGreaterThan(0);
        }
      }
    },
  );

  it("maps the five standard keys to the expected animation-* longhands", () => {
    const style = assignmentStyle(sampleEntry, sampleVersion);
    const byKey = Object.fromEntries(sampleEntry.params.map((p) => [p.key, p]));
    if (byKey.duration) expect(style["animation-duration"]).toBe(byKey.duration.default);
    if (byKey.delay) expect(style["animation-delay"]).toBe(byKey.delay.default);
    if (byKey.easing) expect(style["animation-timing-function"]).toBe(byKey.easing.default);
    if (byKey.iteration) expect(style["animation-iteration-count"]).toBe(byKey.iteration.default);
    if (byKey.direction) expect(style["animation-direction"]).toBe(byKey.direction.default);
  });

  it("overriding one param changes exactly that property", () => {
    const baseline = assignmentStyle(sampleEntry, sampleVersion);
    const [param] = sampleEntry.params;
    const overridden = assignmentStyle(sampleEntry, sampleVersion, { [param.key]: "OVERRIDDEN-VALUE" });

    const changedProps = Object.keys(baseline).filter((prop) => baseline[prop] !== overridden[prop]);
    expect(changedProps).toHaveLength(1);
    expect(overridden[changedProps[0]]).toBe("OVERRIDDEN-VALUE");
  });

  it.each(allEntries.filter(({ entry }) => entry.baseStyles))(
    "carries $entry.id ($version)'s baseStyles into the assignment",
    ({ version, entry }) => {
      const style = assignmentStyle(entry, version);
      for (const [property, value] of Object.entries(parseDeclarations(entry.baseStyles ?? ""))) {
        expect(style[property]).toBe(value);
      }
    },
  );

  it("lets the assignment's own declarations win over a baseStyles conflict", () => {
    const entry: CatalogEntry = {
      ...sampleEntry,
      baseStyles: "animation-duration: 1s; --vm-distance: 1px; transform-origin: top;",
      params: [
        { key: "duration", type: "duration", default: "600ms" },
        { key: "distance", type: "length", default: "24px", cssVar: "--vm-distance" },
      ],
    };
    const style = assignmentStyle(entry, sampleVersion);

    expect(style["animation-duration"]).toBe("600ms");
    expect(style["--vm-distance"]).toBe("24px");
    // …and a declaration the assignment has no opinion about is kept.
    expect(style["transform-origin"]).toBe("top");
  });

  it("throws for a param with neither a standard mapping nor a cssVar", () => {
    const brokenEntry: CatalogEntry = {
      ...sampleEntry,
      params: [{ key: "mysteryParam", type: "number", default: "1" }],
    };
    expect(() => assignmentStyle(brokenEntry, sampleVersion)).toThrow();
  });
});

describe("runtimeStylesheet", () => {
  it("emits one keyframes block per distinct (entry, version) pair", () => {
    const pairs = allEntries
      .slice(0, 3)
      .map(({ entry, version }) => [entry, version] as const);
    const css = runtimeStylesheet(pairs);

    for (const { entry, version } of allEntries.slice(0, 3)) {
      expect(css).toContain(`@keyframes ${keyframesName(entry.id, version)} {`);
    }
  });

  it("de-duplicates repeated (entry, version) pairs", () => {
    const pair = [sampleEntry, sampleVersion] as const;
    const css = runtimeStylesheet([pair, pair, pair]);
    const name = keyframesName(sampleEntry.id, sampleVersion);
    const occurrences = css.split(`@keyframes ${name} {`).length - 1;
    expect(occurrences).toBe(1);
  });

  it("returns an empty string for no pairs", () => {
    expect(runtimeStylesheet([])).toBe("");
  });
});

describe("inlineStyle", () => {
  it("camel-cases the standard animation-* properties, for a React style object", () => {
    const entry = CATALOGS[CURRENT_VERSION].entries.find((e) => e.id === "fade-in-up")!;
    const style = inlineStyle(entry, CURRENT_VERSION);

    expect(style.animationName).toBe(keyframesName(entry.id, CURRENT_VERSION));
    expect(style.animationDuration).toBe("600ms");
    expect(style.animationTimingFunction).toBe("ease-out");
    expect(style.animationFillMode).toBe("both");
    expect(style).not.toHaveProperty("animation-name");
  });

  it("leaves custom properties alone — React sets those verbatim", () => {
    const entry = CATALOGS[CURRENT_VERSION].entries.find((e) => e.id === "fade-in-up")!;
    expect(inlineStyle(entry, CURRENT_VERSION)["--vm-distance"]).toBe("24px");
  });

  it("carries overrides through, exactly like assignmentStyle", () => {
    const style = inlineStyle(sampleEntry, sampleVersion, { duration: "1200ms" });
    expect(style.animationDuration).toBe("1200ms");
  });

  it("camel-cases a baseStyles property too, so React really applies it", () => {
    const entry = CATALOGS[CURRENT_VERSION].entries.find((e) => e.id === "shimmer")!;
    const style = inlineStyle(entry, CURRENT_VERSION);

    expect(style.backgroundImage).toContain("linear-gradient(");
    expect(style.backgroundSize).toBe("200% 100%");
    expect(style.backgroundRepeat).toBe("no-repeat");
    expect(style).not.toHaveProperty("background-image");
  });

  it("keeps the same key count as assignmentStyle for every catalog entry", () => {
    for (const { entry, version } of allEntries) {
      expect(Object.keys(inlineStyle(entry, version))).toHaveLength(
        Object.keys(assignmentStyle(entry, version)).length,
      );
    }
  });
});
