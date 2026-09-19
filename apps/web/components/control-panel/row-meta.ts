/**
 * "load · 600ms · 0ms" — the handoff's row meta, shared by the idle panel's
 * ANIMATED list and the auto-generate result list. `Assignment.params` is
 * partial, so a missing timing is left out rather than rendered as an empty
 * segment ("load ·  · ").
 */
export function rowMeta({
  trigger,
  duration,
  delay,
}: {
  trigger: string;
  duration?: string;
  delay?: string;
}): string {
  return [trigger, duration, delay].filter(Boolean).join(" · ");
}
