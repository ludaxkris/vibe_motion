import { CATALOGS, CATALOG_VERSIONS, keyframesName } from "animation-catalog";
import type { CatalogEntry } from "animation-catalog";
import postcss from "postcss";
import { describe, expect, it } from "vitest";

import {
  assignmentStyle,
  keyframesCss,
  resolveParams,
  runtimeStylesheet,
} from "@/lib/runtime-css";

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
    expect(css).toMatch(/@keyframes vm-[a-z0-9-]+-v\d+ \{/);
  });
});

describe("assignmentStyle", () => {
  it.each(allEntries)(
    "covers every param of $entry.id ($version) with a standard property or a --vm- custom property",
    ({ version, entry }) => {
      const style = assignmentStyle(entry, version);

      expect(style["animation-name"]).toBe(keyframesName(entry.id, version));

      // animation-name plus exactly one declaration per catalog param.
      expect(Object.keys(style)).toHaveLength(1 + entry.params.length);

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
