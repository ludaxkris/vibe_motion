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
// same major already published — that would be a breaking change disguised as non-major. So for
// any two published versions A < B sharing a MAJOR: every animationId in A must exist in B, and
// for every id both declare, every param key in A must exist in B (an id/key may be added going
// forward, never removed, within a major).
const byMajor = new Map(); // major -> [{ version, catalog }] ascending
for (const { version } of files) {
  const catalog = catalogsByVersion.get(version);
  if (!catalog) continue; // already reported as invalid above
  const major = version.split(".")[0];
  if (!byMajor.has(major)) byMajor.set(major, []);
  byMajor.get(major).push({ version, catalog });
}
for (const versionsInMajor of byMajor.values()) {
  for (let i = 0; i < versionsInMajor.length; i++) {
    for (let j = i + 1; j < versionsInMajor.length; j++) {
      const a = versionsInMajor[i];
      const b = versionsInMajor[j];
      const bEntries = new Map(b.catalog.entries.map((e) => [e.id, e]));
      for (const entryA of a.catalog.entries) {
        const entryB = bEntries.get(entryA.id);
        if (!entryB) {
          problems.push(
            `${entryA.id}: present in ${a.version} but missing from ${b.version} (both major ${a.version.split(".")[0]}); ` +
              `a minor/patch release must not drop an animation an earlier release in the same major already published`,
          );
          continue;
        }
        const keysB = new Set(entryB.params.map((p) => p.key));
        for (const p of entryA.params) {
          if (!keysB.has(p.key)) {
            problems.push(
              `${a.version}/${entryA.id}: param ${p.key} exists in ${a.version} but not in ${b.version} ` +
                `(both major ${a.version.split(".")[0]}); a minor/patch release must not drop a param an earlier release already published`,
            );
          }
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
