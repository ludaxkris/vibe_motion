/**
 * Reduced motion on `/help`, decided in CSS rather than in JavaScript.
 *
 * `/help` is a static page: the server cannot read `prefers-reduced-motion`,
 * and a client hook only knows the answer after hydration — by which time a
 * user who asked for less motion has already watched 26 demos play. So the
 * cards always carry their `animation-*` inline style, and this rule, shipped
 * in the page's own `<style id="vm-runtime">`, is what holds them still. It
 * needs `!important` because it is overruling an inline style.
 *
 * `data-vm-replayed` is the exemption: the card sets it for the length of a
 * run the user asked for (↻, or "↻ Replay all"), because an explicit request
 * outranks the preference. `components/help/catalog-card.tsx` writes both
 * attributes; nothing else uses them.
 *
 * `background-image` goes with the animation, and that needs explaining. A
 * catalog entry's `baseStyles` set up the surface its keyframes then animate,
 * and some of those surfaces only read as themselves while something is moving
 * over them: `underline-sweep` paints a full-bleed `linear-gradient` and leaves
 * it to its keyframes to give it a `background-size`, so the picture is a 2px
 * underline sweeping across. Hold the animation still and the same gradient
 * floods the whole box in `currentColor` — a solid black rectangle where a
 * demo should be.
 *
 * So a held demo loses that paint too. Generically, never per animation: which
 * entries need a resting `background-size` is the catalog's business, and the
 * rule that a demo held still must not show mid-animation paint is this page's.
 * Dropping the image is safe for every entry because the demo block's own
 * violet is a background-*colour*, which this leaves alone.
 */
export const REDUCED_MOTION_DEMO_CSS = `@media (prefers-reduced-motion: reduce) {
  [data-vm-demo]:not([data-vm-replayed]) {
    animation-name: none !important;
    background-image: none !important;
  }
}`;
