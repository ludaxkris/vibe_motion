import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const versionsDir = path.join(pkgRoot, "versions");
export const SEMVER = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

export function compareSemver(a, b) {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] - pb[i];
  return 0;
}

/** All published version files, ascending semver. */
export function listVersionFiles() {
  if (!existsSync(versionsDir)) return [];
  return readdirSync(versionsDir)
    .filter((f) => f.endsWith(".json"))
    .map((f) => f.slice(0, -5))
    .sort(compareSemver)
    .map((v) => ({ version: v, file: path.join(versionsDir, `${v}.json`) }));
}

export function readCurrent() {
  return readFileSync(path.join(pkgRoot, "current"), "utf8").trim();
}

export function readCatalog(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

export function readSchema() {
  return JSON.parse(readFileSync(path.join(pkgRoot, "schema.json"), "utf8"));
}

export const STANDARD_PARAM_KEYS = new Set(["duration", "delay", "easing", "iteration", "direction", "fillMode"]);
