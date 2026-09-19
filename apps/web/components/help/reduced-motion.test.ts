import { describe, expect, it } from "vitest";

import { REDUCED_MOTION_DEMO_CSS } from "./reduced-motion";

/** The rule body, as the stylesheet ships it. */
const SELECTOR = "[data-vm-demo]:not([data-vm-replayed])";

describe("REDUCED_MOTION_DEMO_CSS", () => {
  it("only applies under prefers-reduced-motion, and only to an unasked-for demo", () => {
    expect(REDUCED_MOTION_DEMO_CSS).toContain("@media (prefers-reduced-motion: reduce)");
    expect(REDUCED_MOTION_DEMO_CSS).toContain(SELECTOR);
    // `data-vm-replayed` is the exemption: an explicit ↻ outranks the
    // preference, so the rule must not reach a block carrying it.
    expect(REDUCED_MOTION_DEMO_CSS).not.toMatch(/\[data-vm-demo\]\s*\{/);
  });

  it("holds the animation still", () => {
    expect(REDUCED_MOTION_DEMO_CSS).toContain("animation-name: none !important");
  });

  it("also takes away the paint that only makes sense mid-animation", () => {
    // A catalog entry's `baseStyles` set up the surface its keyframes animate,
    // and some of them are only coherent while the animation is running:
    // `underline-sweep` paints a full-bleed `linear-gradient` and relies on its
    // keyframes for the `background-size` that turns it into a 2px underline.
    // Held still, that is a solid block of `currentColor`. Nothing here may key
    // on an animation id, so the rule drops the image for every held demo —
    // safe, because the demo block's own colour is a background-*colour*, which
    // this does not touch.
    expect(REDUCED_MOTION_DEMO_CSS).toContain("background-image: none !important");
  });

  it("overrules the inline style with !important on every declaration it sets", () => {
    const declarations = (REDUCED_MOTION_DEMO_CSS.match(/[\w-]+\s*:\s*[^;{}]+/g) ?? []).filter(
      (declaration) => !declaration.startsWith("prefers-reduced-motion"),
    );
    expect(declarations.length).toBeGreaterThan(0);
    for (const declaration of declarations) {
      expect(declaration, declaration).toContain("!important");
    }
  });
});
