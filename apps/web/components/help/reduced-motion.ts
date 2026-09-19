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
 */
export const REDUCED_MOTION_DEMO_CSS = `@media (prefers-reduced-motion: reduce) {
  [data-vm-demo]:not([data-vm-replayed]) { animation-name: none !important; }
}`;
