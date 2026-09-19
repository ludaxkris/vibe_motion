/**
 * The help card's defaults line.
 *
 * `docs/design/README.md` "4. Help" prints an animation's defaults as one mono
 * line under its name ("600ms · ease-out · distance 24px"). The line is read
 * off the catalog entry, never written by hand, so a new animation gets one
 * for free and a param change cannot leave it stale.
 *
 * Pure: no React, no DOM.
 */
import type { CatalogEntry } from "@/lib/api-client";
import { isStandardParamKey } from "@/lib/runtime-css";

/**
 * Values that say nothing, keyed by the standard param they belong to: the
 * line is a summary, and "0ms", "once" and "forwards" are what every reader
 * already assumes. `fillMode` is on every entry in the catalog and is never
 * about the feel of the animation, so it is always dropped.
 */
const QUIET_DEFAULTS: Readonly<Record<string, string | null>> = {
  delay: "0ms",
  iteration: "1",
  direction: "normal",
  fillMode: null,
};

function isQuiet(key: string, value: string): boolean {
  // `hasOwn`, not `in`: the key comes from the catalog, and `toString` would
  // otherwise answer yes and resolve to an inherited function.
  if (!Object.hasOwn(QUIET_DEFAULTS, key)) return false;
  const quiet = QUIET_DEFAULTS[key];
  return quiet === null || quiet === value;
}

/**
 * `entry`'s default params as one line, in catalog order: standard params
 * (duration, delay, easing, iteration, direction) as bare CSS values, every
 * animation-specific one as `key value`. Params whose default carries no
 * information are left out — see `QUIET_DEFAULTS`.
 */
export function defaultsLine(entry: CatalogEntry): string {
  return entry.params
    .filter((param) => !isQuiet(param.key, param.default))
    .map((param) =>
      isStandardParamKey(param.key) ? param.default : `${param.key} ${param.default}`,
    )
    .join(" · ");
}
