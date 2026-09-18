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

if (files.length === 0) problems.push("no files under versions/");

for (const { version, file } of files) {
  if (!SEMVER.test(version)) problems.push(`${file}: file name is not a semver`);
  const catalog = readCatalog(file);
  if (!validate(catalog)) {
    for (const e of validate.errors ?? []) problems.push(`${version}: ${e.instancePath || "/"} ${e.message}`);
    continue;
  }
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
    }
    if (entry.defaultTrigger && !entry.triggers.includes(entry.defaultTrigger)) {
      problems.push(`${version}/${entry.id}: defaultTrigger ${entry.defaultTrigger} not in triggers`);
    }
    // fillMode became a standard key in 1.1.0 (CLAUDE.md: every animation exposes the
    // standard animation-* properties including fill-mode). 1.0.0 predates it and is exempt.
    if (compareSemver(version, "1.1.0") >= 0 && !keys.has("fillMode")) {
      problems.push(`${version}/${entry.id}: missing fillMode param (standard key from 1.1.0 onward)`);
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
