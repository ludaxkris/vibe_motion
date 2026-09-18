"use client";

import { useSyncExternalStore } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

/**
 * Read as an external store rather than a `useState` + `useEffect` pair: React
 * renders `getServerSnapshot()` for both the server render and the first
 * client (hydration) render, so the two always agree, then swaps in the real
 * value immediately after — with no `setState` inside an effect.
 */
function subscribe(onChange: () => void): () => void {
  if (typeof window.matchMedia !== "function") return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  // An explicit `removeEventListener` cleanup rather than an AbortSignal:
  // jsdom rejects the Node `AbortSignal` the test environment installs
  // globally (see vitest.setup.ts).
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  if (typeof window.matchMedia !== "function") return false;
  return window.matchMedia(REDUCED_MOTION).matches;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * `true` while the OS asks for reduced motion.
 *
 * The chrome's own transitions handle this in CSS (`globals.css` zeroes the
 * `--dur-*` tokens under the media query), but motion a component *starts* —
 * the picker cards playing their animation on hover — has to be decided in
 * JavaScript, so this is the one place that reads the query.
 */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
