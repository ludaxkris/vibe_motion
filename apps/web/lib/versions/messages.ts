/**
 * What the two writes on the editor screen — Save
 * (`components/editor/use-save-flow.ts`) and Restore
 * (`components/history/use-version-history.ts`) — say and how patiently they
 * wait when the project is locked.
 *
 * Shared so the reader cannot be told two different things about the same
 * `503`, and so neither feature has to import from the other.
 */

/** Two attempts is all a `503` gets; the third answer would be a guess about the fourth. */
export const BUSY_MESSAGE = "The project is busy. Try again in a moment.";

/** A `Retry-After` the service should never send must not wedge the UI either. */
export const MAX_RETRY_SECONDS = 5;
