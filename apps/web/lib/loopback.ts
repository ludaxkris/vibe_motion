/**
 * The *other* spelling of this machine.
 *
 * `localhost` and `127.0.0.1` are the same server and two different origins,
 * which is the one thing mock mode needs: the editor shell and the cloned-page
 * iframe must not be same-origin, or a bridge that skipped its origin check
 * would pass every e2e run (spec §2, "Mock mode stays cross-origin"). So the
 * shell serves itself from one of the two and frames the other.
 *
 * Pure, and takes the location as data: nothing here reads `window`, and no
 * port is hardcoded — the swap carries whatever port the dev server actually
 * got.
 */

/** A `Location`-shaped input: `window.location` and a `URL` both satisfy it. */
export type OriginParts = {
  /** Including the colon, as `location.protocol` has it. */
  protocol: string;
  hostname: string;
  /** Empty string when the URL uses the protocol's default port. */
  port: string;
};

/**
 * The two spellings, each pointing at the other. Only these two: `::1` is a
 * third origin again but is not reliably reachable (Docker, CI and some
 * machines run without IPv6 loopback), and any other host is not this machine.
 */
const SIBLING: Readonly<Record<string, string>> = {
  localhost: "127.0.0.1",
  "127.0.0.1": "localhost",
};

/**
 * The same server under its other loopback name, or `null` when the caller is
 * not on a loopback host at all and there is nothing to swap.
 */
export function siblingLoopbackOrigin(parts: OriginParts): string | null {
  const sibling = SIBLING[parts.hostname];
  if (!sibling) return null;
  return `${parts.protocol}//${sibling}${parts.port ? `:${parts.port}` : ""}`;
}
