import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { CATALOGS, CATALOG_VERSIONS } from "animation-catalog";
import type { CatalogEntry, CatalogParam } from "animation-catalog";
import { describe, expect, it } from "vitest";

import { assignmentStyle, baseStyleDeclarations, keyframesCss } from "@/lib/runtime-css";

/**
 * The cross-language parity fixture.
 *
 * The preview generator lives here in TypeScript; the exporter is Kotlin. They have to agree on
 * every byte of CSS for every published `(catalogVersion, animationId)` pair, or a designer's
 * export will not be what the designer saw. Nothing but a shared artefact can prove that, so this
 * test *is* the generator: it produces `export-parity.json` from the real `runtime-css` functions,
 * and `apps/api`'s `ExportParityTest` reads the committed file off its test classpath and holds
 * the Kotlin emitter to it.
 *
 * `apps/web` has no TypeScript runner other than vitest, so staleness is a test rather than a
 * script: regenerate deliberately with
 *
 *     VM_UPDATE_PARITY=1 pnpm --filter web test export-parity
 *
 * and read the diff. A change here is a change to what every future export renders.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_PATH = path.join(here, "export-parity.json");

type Case = {
  variant: "defaults" | "all" | "partial";
  params: Record<string, string>;
  /** Every `animation-*` longhand `assignmentStyle` writes, `animation-name` included. */
  longhands: Record<string, string>;
  /** Every `--vm-*` custom property, in catalog param order. */
  customProperties: Record<string, string>;
};

type Entry = {
  version: string;
  animationId: string;
  /** The full `@keyframes <name> { … }` block, which the Kotlin emitter must match byte for byte. */
  keyframesCss: string;
  /** TypeScript's *parsed*, ordered declaration map for the entry's `baseStyles`. */
  baseStyles: Record<string, string>;
  cases: Case[];
};

type Fixture = {
  generator: string;
  entries: Entry[];
};

/**
 * A valid value for `param` that is not its default.
 *
 * It has to pass the API's own `paramValueProblem` — the exporter re-validates everything it
 * emits — so each value is taken from what the catalog itself declares: an option, a bound, or a
 * keyword of the right type.
 */
function nonDefaultValue(param: CatalogParam): string {
  switch (param.type) {
    case "select": {
      const options = param.options ?? [];
      return options.find((option) => option !== param.default) ?? param.default;
    }
    case "direction":
      return param.default === "reverse" ? "alternate" : "reverse";
    case "easing":
      return param.default === "linear" ? "ease-in-out" : "linear";
    case "iteration":
      return param.default === "3" ? "4" : "3";
    case "color":
      return param.default === "#112233" ? "#445566" : "#112233";
    default: {
      // The bounded numeric types (duration, length, number, angle, percentage): a bound is by
      // definition inside the range, and the catalog declares both for every one of them.
      if (param.min !== undefined && param.min !== param.default) return param.min;
      if (param.max !== undefined && param.max !== param.default) return param.max;
      return param.default;
    }
  }
}

function casesFor(entry: CatalogEntry): Array<{ variant: Case["variant"]; params: Record<string, string> }> {
  const all: Record<string, string> = {};
  const partial: Record<string, string> = {};
  entry.params.forEach((param, index) => {
    all[param.key] = nonDefaultValue(param);
    // Every other key: a state where some params are stored and the rest fall back to the
    // catalog default, which is what a real assignment usually looks like.
    if (index % 2 === 0) partial[param.key] = nonDefaultValue(param);
  });

  return [
    { variant: "defaults", params: {} },
    { variant: "all", params: all },
    { variant: "partial", params: partial },
  ];
}

function buildFixture(): Fixture {
  const entries: Entry[] = [];

  for (const version of CATALOG_VERSIONS) {
    for (const entry of CATALOGS[version].entries) {
      entries.push({
        version,
        animationId: entry.id,
        keyframesCss: keyframesCss(entry, version),
        baseStyles: baseStyleDeclarations(entry),
        cases: casesFor(entry).map(({ variant, params }) => {
          const style = assignmentStyle(entry, version, params);
          const longhands: Record<string, string> = {};
          const customProperties: Record<string, string> = {};
          for (const [property, value] of Object.entries(style)) {
            if (property.startsWith("animation")) longhands[property] = value;
            else if (property.startsWith("--")) customProperties[property] = value;
          }
          return { variant, params, longhands, customProperties };
        }),
      });
    }
  }

  return {
    generator: "apps/web/lib/runtime-css/export-parity.test.ts — VM_UPDATE_PARITY=1 to regenerate",
    entries,
  };
}

describe("export parity fixture", () => {
  const generated = buildFixture();
  const serialised = `${JSON.stringify(generated, null, 2)}\n`;

  if (process.env.VM_UPDATE_PARITY === "1") {
    writeFileSync(FIXTURE_PATH, serialised);
  }

  it("is committed and up to date with the real runtime-css functions", () => {
    // A stale fixture means the Kotlin exporter is being held to yesterday's TypeScript.
    expect(readFileSync(FIXTURE_PATH, "utf8")).toBe(serialised);
  });

  it("covers every published (version, animationId) pair", () => {
    const expected = CATALOG_VERSIONS.flatMap((version) =>
      CATALOGS[version].entries.map((entry) => `${version}/${entry.id}`),
    );

    expect(generated.entries.map((entry) => `${entry.version}/${entry.animationId}`)).toEqual(expected);
    expect(expected.length).toBeGreaterThan(0);
  });

  it("gives every entry three cases: no params, every param changed, and a partial set", () => {
    for (const entry of generated.entries) {
      expect(entry.cases.map((one) => one.variant)).toEqual(["defaults", "all", "partial"]);

      const [defaults, all] = entry.cases;
      expect(defaults.params).toEqual({});
      const source = CATALOGS[entry.version as keyof typeof CATALOGS].entries.find((e) => e.id === entry.animationId);
      expect(Object.keys(all.params)).toEqual(source?.params.map((param) => param.key));
    }
  });

  it("changes something for every param in the 'all' case", () => {
    for (const entry of generated.entries) {
      const source = CATALOGS[entry.version as keyof typeof CATALOGS].entries.find((e) => e.id === entry.animationId);
      const [defaults, all] = entry.cases;

      for (const param of source?.params ?? []) {
        const property = param.cssVar ?? undefined;
        const before = property ? defaults.customProperties[property] : undefined;
        const after = property ? all.customProperties[property] : undefined;
        if (property) expect(after).not.toBe(before);
      }
      // Standard params move too, or the longhand halves of the comparison would be vacuous.
      expect(all.longhands).not.toEqual(defaults.longhands);
    }
  });

  it("writes every animation longhand the preview sets, animation-name included", () => {
    for (const entry of generated.entries) {
      for (const one of entry.cases) {
        expect(one.longhands["animation-name"]).toBeTruthy();
        for (const property of Object.keys(one.longhands)) {
          expect(property.startsWith("animation")).toBe(true);
        }
        for (const property of Object.keys(one.customProperties)) {
          expect(property.startsWith("--vm-")).toBe(true);
        }
      }
    }
  });
});
