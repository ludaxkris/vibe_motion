/**
 * Compiled-CSS guard.
 *
 * `globals.css.test.ts` proves the token *values* are right; this proves the
 * utilities built on them actually emit CSS. Asserting class names on an
 * element cannot catch a utility Tailwind silently declines to generate — which
 * is exactly what happened with `duration-fast`: Tailwind 4 has no
 * `--duration-*` theme namespace, so every chrome transition fell back to
 * tw-animate-css's .15s default and the `prefers-reduced-motion` block, which
 * zeroes `--dur-*`, had nothing reading it.
 *
 * So: run the real `app/globals.css` and the real source tree through the same
 * PostCSS plugin the Next build uses, and assert on the output.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/postcss";
import postcss from "postcss";
import { beforeAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEB_ROOT = path.resolve(HERE, "..");
const GLOBALS_CSS = path.join(HERE, "globals.css");

let css = "";

beforeAll(async () => {
  const result = await postcss([tailwindcss({ base: WEB_ROOT })]).process(
    readFileSync(GLOBALS_CSS, "utf8"),
    { from: GLOBALS_CSS },
  );
  css = result.css;
}, 120_000);

describe("compiled globals.css", () => {
  it("compiles to something", () => {
    expect(css.length).toBeGreaterThan(1000);
  });

  it.each([
    ["--dur-fast", /transition-duration:\s*var\(--dur-fast\)/],
    ["--dur-base", /transition-duration:\s*var\(--dur-base\)/],
  ])("drives chrome transitions from %s", (_token, pattern) => {
    expect(css).toMatch(pattern);
  });

  it("drives the toast's slide-up animation from --dur-base", () => {
    // tw-animate-css reads `--tw-duration` for `animate-in`, so the duration
    // utility has to set it, not just `transition-duration`.
    expect(css).toMatch(/--tw-duration:\s*var\(--dur-base\)/);
    expect(css).toMatch(/animation:\s*enter var\(--tw-animation-duration,\s*var\(--tw-duration/);
  });

  it("zeroes the chrome duration tokens under prefers-reduced-motion", () => {
    const block = css.match(
      /@media\s*\(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*?--dur-base:\s*0ms;[\s\S]*?\}\s*\}/,
    );
    expect(block, "reduced-motion block with --dur-* overrides").not.toBeNull();
  });

  it("never reintroduces a --duration-* theme key (Tailwind has no such namespace)", () => {
    expect(css).not.toMatch(/--duration-(instant|fast|base)\s*:/);
  });

  it("emits the focus ring outline from the accent-soft token", () => {
    expect(css).toMatch(/outline:\s*var\(--vm-focus-ring-width\)\s*solid\s*var\(--vm-focus-ring-color\)/);
  });

  it("generates the clone bar's indeterminate sweep, keyframes and all", () => {
    // `POST /projects` reports no progress, so the bar can only say "working".
    // A theme animation key is the only form Tailwind will emit the keyframes
    // for alongside the utility.
    expect(css).toMatch(/@keyframes vm-indeterminate\b/);
    expect(css).toMatch(/animate-vm-indeterminate\s*\{[^}]*animation:\s*vm-indeterminate/);
  });

  it("generates the wrapper focus ring the slider thumb, Input and NumberField use", () => {
    expect(css).toContain(String.raw`.has-\[input\:focus-visible\]\:focus-ring`);
  });
});
