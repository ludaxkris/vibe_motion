// Its own file: index.ts → mock-agent.ts → index.ts would be a cycle.

/** Delay step between consecutive `load` entrances, in document order. */
export const STAGGER_MS = 60;
/** The stagger never pushes a delay past this. */
export const STAGGER_CAP_MS = 600;
/**
 * Animations the agent never suggests because they paint at rest (DT-116
 * class). A guard only: neither is in the `entrance` or `hover` pools today.
 */
export const EXCLUDED_ANIMATION_IDS: readonly string[] = ["underline-sweep", "shimmer"];
