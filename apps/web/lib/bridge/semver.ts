/**
 * The one version question the shell asks of the bridge: "are you at least
 * this new?" (`ready.bridgeVersion`, protocol spec "Versioning").
 *
 * Numeric per segment — `"1.10.0"` is newer than `"1.9.0"`, which a string
 * compare gets wrong. Strict `major.minor.patch` of plain digits only: anything
 * else (missing, not a string, a pre-release tag) answers `false`, because the
 * caller's safe side is "treat it as too old".
 */
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)$/;

function parse(version: unknown): [number, number, number] | null {
  if (typeof version !== "string") return null;
  const match = SEMVER_RE.exec(version);
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function atLeast(version: unknown, min: string): boolean {
  const have = parse(version);
  const need = parse(min);
  if (!have || !need) return false;
  for (let i = 0; i < 3; i += 1) {
    if (have[i] !== need[i]) return have[i] > need[i];
  }
  return true;
}
