#!/usr/bin/env node
// Gate: regenerate every committed generated artifact and fail if the result differs
// from what is on disk. Catches "edited openapi.yaml / catalog but forgot to regenerate".
// Compares file contents before vs after regeneration (not against git), so it works on
// uncommitted local changes too and leaves the tree exactly as it found it on success.
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generated = ["packages/animation-catalog/src", "apps/web/lib/api-client/schema.d.ts"];

function files(p) {
  const abs = path.join(root, p);
  if (statSync(abs).isFile()) return [p];
  return readdirSync(abs, { recursive: true })
    .map((f) => path.join(p, String(f)))
    .filter((f) => statSync(path.join(root, f)).isFile())
    .sort();
}

function snapshot() {
  const out = new Map();
  for (const f of generated.flatMap(files)) out.set(f, createHash("sha256").update(readFileSync(path.join(root, f))).digest("hex"));
  return out;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { cwd: root, stdio: "inherit" });
  if (r.status !== 0) {
    console.error(`check-generated: "${[cmd, ...args].join(" ")}" failed`);
    process.exit(1);
  }
}

const before = snapshot();
run("pnpm", ["--filter", "animation-catalog", "exec", "node", "scripts/gen-types.mjs"]);
run("pnpm", ["--filter", "web", "gen:client"]);
const after = snapshot();

const stale = [...new Set([...before.keys(), ...after.keys()])].filter((f) => before.get(f) !== after.get(f));
if (stale.length) {
  console.error("check-generated: generated files were out of date (now regenerated — review and commit them):");
  for (const f of stale) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-generated: OK (${after.size} generated file(s) match their sources)`);
