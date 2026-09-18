#!/usr/bin/env node
// Gate: published catalog files are immutable. Any versions/*.json that exists
// on the base branch must be byte-identical on this branch. Only NEW version
// files and the `current` pointer may change.
//
// Base ref: $CATALOG_BASE_REF, else origin/main, else main; the comparison point is
// the merge-base of that ref and HEAD, so a branch cut before a newer catalog version
// landed on main is not blamed for "deleting" it. In CI, the checkout must include
// the base ref (fetch-depth: 0 or an explicit fetch).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { listVersionFiles, pkgRoot } from "./lib.mjs";

function git(args, opts = {}) {
  return execFileSync("git", args, { cwd: pkgRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], ...opts }).trim();
}

function sha(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

let baseRef = process.env.CATALOG_BASE_REF;
if (!baseRef) {
  for (const candidate of ["origin/main", "main"]) {
    try {
      git(["rev-parse", "--verify", "--quiet", candidate]);
      baseRef = candidate;
      break;
    } catch {
      /* try next */
    }
  }
}
if (!baseRef) {
  console.error("catalog immutable: cannot find a base ref (origin/main or main). Set CATALOG_BASE_REF.");
  process.exit(1);
}
let baseCommit = baseRef;
try {
  baseCommit = git(["merge-base", baseRef, "HEAD"]);
} catch {
  /* unrelated histories or detached state: fall back to the ref itself */
}

// Path of versions/ relative to the repo root, as git sees it (avoids /var vs /private/var symlink issues).
const relVersionsDir = `${git(["rev-parse", "--show-prefix"])}versions`;

let baseFiles;
try {
  baseFiles = git(["ls-tree", "--full-tree", "--name-only", baseCommit, `${relVersionsDir}/`]).split("\n").filter(Boolean);
} catch {
  baseFiles = []; // base has no catalog yet (first introduction) — nothing to protect
}

const violations = [];
for (const rel of baseFiles) {
  if (!rel.endsWith(".json")) continue;
  const name = path.basename(rel);
  const local = listVersionFiles().find((f) => path.basename(f.file) === name);
  if (!local) {
    violations.push(`${name}: exists on ${baseRef} but was deleted on this branch`);
    continue;
  }
  const baseBlob = execFileSync("git", ["show", `${baseCommit}:${rel}`], { cwd: pkgRoot });
  if (sha(baseBlob) !== sha(readFileSync(local.file))) {
    violations.push(`${name}: differs from ${baseRef}. Published catalog files are immutable; add a new version file instead.`);
  }
}

if (violations.length) {
  console.error(`catalog immutable: ${violations.length} violation(s) against ${baseRef}`);
  for (const v of violations) console.error(`  - ${v}`);
  process.exit(1);
}
console.log(`catalog immutable: OK (${baseFiles.length} published file(s) at merge-base with ${baseRef} unchanged)`);
