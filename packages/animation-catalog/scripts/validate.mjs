#!/usr/bin/env node
// Gate: every versions/*.json validates against schema.json, its `version`
// matches its file name, ids are unique within a file, `current` points at a
// published version, and non-standard params declare cssVar (schema also
// enforces this; we report it in plain words here).

import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  compareSemver,
  listVersionFiles,
  readCatalog,
  readCurrent,
  readSchema,
  SEMVER,
  STANDARD_PARAM_KEYS,
} from "./lib.mjs";

const ajv = new Ajv2020({ allErrors: true, strict: true, strictRequired: false });
addFormats(ajv);
const validate = ajv.compile(readSchema());

const files = listVersionFiles();
const problems = [];
const catalogsByVersion = new Map();

if (files.length === 0) problems.push("no files under versions/");

for (const { version, file } of files) {
  if (!SEMVER.test(version)) problems.push(`${file}: file name is not a semver`);
  const catalog = readCatalog(file);
  if (!validate(catalog)) {
    for (const e of validate.errors ?? []) problems.push(`${version}: ${e.instancePath || "/"} ${e.message}`);
    continue;
  }
  catalogsByVersion.set(version, catalog);
  if (catalog.version !== version) problems.push(`${version}: "version" field is ${catalog.version}, must equal the file name`);
  const ids = new Set();
  for (const entry of catalog.entries) {
    if (ids.has(entry.id)) problems.push(`${version}: duplicate id ${entry.id}`);
    ids.add(entry.id);
    const keys = new Set();
    for (const p of entry.params) {
      if (keys.has(p.key)) problems.push(`${version}/${entry.id}: duplicate param key ${p.key}`);
      keys.add(p.key);
      if (!STANDARD_PARAM_KEYS.has(p.key) && !p.cssVar) problems.push(`${version}/${entry.id}: param ${p.key} needs cssVar`);
      if (p.cssVar && !entry.keyframes.includes(`var(${p.cssVar})`) && !(entry.baseStyles ?? "").includes(`var(${p.cssVar})`)) {
        problems.push(`${version}/${entry.id}: ${p.cssVar} is declared but never referenced in keyframes or baseStyles`);
      }
      // type: "select" needs somewhere to choose from, and a default that is one of the choices.
      // No versions/*.json published so far (1.0.0 or 1.1.0) has a select param without options,
      // so this rule applies unconditionally; if a future version ever needs an exception, scope
      // it here the same way the fillMode rule below is scoped by version.
      if (p.type === "select") {
        if (!Array.isArray(p.options) || p.options.length === 0) {
          problems.push(`${version}/${entry.id}: param ${p.key} is type select but declares no options`);
        } else if (!p.options.includes(p.default)) {
          problems.push(`${version}/${entry.id}: param ${p.key} default "${p.default}" is not one of its options`);
        }
      }
    }
    // The cssVar <-> keyframes/baseStyles relationship must hold in both directions: the check
    // above catches a declared cssVar that's never referenced; this catches the reverse — a
    // var(--vm-x) referenced in keyframes or baseStyles that no param on this entry declares via
    // cssVar, which would render as an unset custom property (falling back to nothing) rather
    // than the intended value.
    const declaredCssVars = new Set(entry.params.filter((p) => p.cssVar).map((p) => p.cssVar));
    const usedCssVars = new Set(
      [...`${entry.keyframes} ${entry.baseStyles ?? ""}`.matchAll(/var\((--vm-[a-zA-Z0-9-]+)/g)].map((m) => m[1]),
    );
    for (const usedVar of usedCssVars) {
      if (!declaredCssVars.has(usedVar)) {
        problems.push(`${version}/${entry.id}: ${usedVar} is referenced in keyframes or baseStyles but not declared by any param's cssVar`);
      }
    }
    if (entry.defaultTrigger && !entry.triggers.includes(entry.defaultTrigger)) {
      problems.push(`${version}/${entry.id}: defaultTrigger ${entry.defaultTrigger} not in triggers`);
    }
    // fillMode became a standard key in 1.1.0 (docs/build_plan.md §4 Phase 1: every animation
    // exposes the standard animation-* properties including fill-mode). Versions before 1.1.0
    // (by semver, not merely "not 1.0.0" — a future 1.0.x metadata-only patch would predate it
    // too) are exempt.
    if (compareSemver(version, "1.1.0") >= 0 && !keys.has("fillMode")) {
      problems.push(`${version}/${entry.id}: missing fillMode param (standard key from 1.1.0 onward)`);
    }
  }
}

// keyframesName() (src/index.ts) now names the exported @keyframes rule by the full catalog
// version (vm-<id>-v<major>-<minor>-<patch>), so (animationId, catalogVersion) is already the
// immutable identity of a keyframes template and two versions can never collide by construction
// — the byte-identical-keyframes freeze this block used to enforce is no longer needed.
//
// What CLAUDE.md's semver contract still requires within a shared MAJOR is a superset relation:
// a MINOR (or PATCH) release must not drop an animation or a param an earlier release in the
// same major already published — that would be a breaking change disguised as non-major. The
// relation is transitive (A ⊆ B ⊆ C implies A ⊆ C), so it is enough to check each consecutive
// pair of versions within a major: every animationId in version N must exist in version N+1, and
// for every id both declare, every param key in N must exist in N+1 (an id/key may be added going
// forward, never removed, within a major). This does not check that a minor's new default
// reproduces the previous rendering — that half of the semver contract is a review responsibility.
const byMajor = new Map(); // major -> [{ version, catalog }] ascending
for (const { version } of files) {
  const catalog = catalogsByVersion.get(version);
  if (!catalog) continue; // already reported as invalid above
  const major = version.split(".")[0];
  if (!byMajor.has(major)) byMajor.set(major, []);
  byMajor.get(major).push({ version, catalog });
}
for (const [major, versionsInMajor] of byMajor) {
  for (let i = 0; i + 1 < versionsInMajor.length; i++) {
    const earlier = versionsInMajor[i];
    const later = versionsInMajor[i + 1];
    const laterEntries = new Map(later.catalog.entries.map((e) => [e.id, e]));
    for (const entry of earlier.catalog.entries) {
      const laterEntry = laterEntries.get(entry.id);
      if (!laterEntry) {
        problems.push(
          `${earlier.version}/${entry.id}: missing from ${later.version} (both major ${major}); ` +
            `a minor/patch release must not drop an animation an earlier release in the same major already published`,
        );
        continue;
      }
      const laterKeys = new Set(laterEntry.params.map((p) => p.key));
      for (const p of entry.params) {
        if (!laterKeys.has(p.key)) {
          problems.push(
            `${earlier.version}/${entry.id}: param ${p.key} missing from ${later.version} (both major ${major}); ` +
              `a minor/patch release must not drop a param an earlier release already published`,
          );
        }
      }
    }
  }
}

const current = readCurrent();
if (!files.some((f) => f.version === current)) problems.push(`current = ${current} but no versions/${current}.json exists`);

if (problems.length) {
  console.error(`catalog validate: ${problems.length} problem(s)`);
  for (const p of problems) console.error(`  - ${p}`);
  process.exit(1);
}
console.log(`catalog validate: ${files.length} version(s) OK (${files.map((f) => f.version).join(", ")}); current = ${current}`);
