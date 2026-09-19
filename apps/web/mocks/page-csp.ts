/**
 * The mock page route's stand-in for the API's `BridgePageRenderer`.
 *
 * Mock mode exists to exercise the *real* bridge against the *real* policy, so
 * the policy has to be the real one:
 * `apps/api/src/main/kotlin/dev/vibemotion/api/clone/BridgePageRenderer.kt`
 * holds the original and this is its transcription. They are two strings that
 * must agree, so `app/mock-api/projects/[projectId]/page/route.test.ts` reads
 * the Kotlin and fails if they ever drift.
 */

/**
 * `default-src 'none'` and then only what a static rendering of someone else's
 * page needs. `script-src 'self'` admits exactly one script — the bridge,
 * served from the frame's own origin — and `connect-src 'none'` is why the
 * bridge can never fetch a catalog and has to be a dumb renderer (spec D1).
 */
export const BASE_POLICY =
  "default-src 'none'; script-src 'self'; style-src 'unsafe-inline' https: http:; " +
  "img-src * data: blob:; font-src * data:; media-src * data: blob:; connect-src 'none'; " +
  "frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'";

/**
 * The response header policy: the base plus the one directive a `<meta>` policy
 * cannot carry, which is what actually keeps the clone out of any frame but the
 * editor's.
 */
export function pagePolicy(shellOrigin: string): string {
  return `${BASE_POLICY}; frame-ancestors ${safeOrigin(shellOrigin)}`;
}

/** Exactly the Kotlin's guard: nothing that could end the directive early. */
function safeOrigin(origin: string): string {
  return origin.replace(/[\s;,]/g, "");
}
