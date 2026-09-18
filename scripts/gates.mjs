#!/usr/bin/env node
// Vibe Motion quality gates. This is what CI runs and what every agent runs
// before marking a PR ready. Usage: node scripts/gates.mjs [web|api|catalog|e2e|all]
//
// Every gate runs even if an earlier one fails, so a single run reports the
// full picture. Exit code is non-zero if any gate failed.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const group = process.argv[2] ?? "all";

const gates = [
  // ---- catalog -------------------------------------------------------------
  { group: "catalog", name: "catalog validate", cmd: "pnpm", args: ["--filter", "animation-catalog", "validate"] },
  { group: "catalog", name: "catalog immutable", cmd: "pnpm", args: ["--filter", "animation-catalog", "check-immutable"] },
  { group: "catalog", name: "catalog test", cmd: "pnpm", args: ["--filter", "animation-catalog", "test"] },
  // ---- web -----------------------------------------------------------------
  { group: "web", name: "web lint", cmd: "pnpm", args: ["--filter", "web", "lint"] },
  { group: "web", name: "web typecheck", cmd: "pnpm", args: ["--filter", "web", "typecheck"] },
  { group: "web", name: "web unit", cmd: "pnpm", args: ["--filter", "web", "test"] },
  { group: "web", name: "web build", cmd: "pnpm", args: ["--filter", "web", "build"] },
  // ---- api -----------------------------------------------------------------
  { group: "api", name: "api check (ktlint + kotest)", cmd: "./gradlew", args: ["check", "--no-daemon", "--console=plain"], cwd: "apps/api" },
  { group: "api", name: "api docker build", cmd: "docker", args: ["build", "-q", "-f", "apps/api/Dockerfile", "-t", "vibe-motion-api:gate", "."], requires: "docker" },
  // ---- e2e -----------------------------------------------------------------
  { group: "e2e", name: "web e2e (playwright)", cmd: "pnpm", args: ["--filter", "web", "e2e"] },
];

const selected = gates.filter((g) => group === "all" || g.group === group);
if (selected.length === 0) {
  console.error(`Unknown gate group "${group}". Use web | api | catalog | e2e | all.`);
  process.exit(2);
}

function have(bin) {
  return spawnSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" }).status === 0;
}

const results = [];
for (const g of selected) {
  const cwd = path.join(root, g.cwd ?? ".");
  const started = Date.now();
  let status, note = "";
  if (g.requires && !have(g.requires)) {
    status = "SKIPPED";
    note = `${g.requires} not available`;
  } else if (g.cwd && !existsSync(cwd)) {
    status = "SKIPPED";
    note = `${g.cwd} does not exist`;
  } else {
    console.log(`\n[1m▶ ${g.name}[0m  (${[g.cmd, ...g.args].join(" ")})`);
    const r = spawnSync(g.cmd, g.args, { cwd, stdio: "inherit", env: process.env, shell: false });
    status = r.status === 0 ? "PASS" : "FAIL";
    if (r.error) note = r.error.message;
  }
  results.push({ ...g, status, note, ms: Date.now() - started });
}

console.log("\n[1mGate summary[0m");
console.log("| Gate | Result | Time |");
console.log("|---|---|---|");
for (const r of results) {
  const color = r.status === "PASS" ? "[32m" : r.status === "FAIL" ? "[31m" : "[33m";
  console.log(`| ${r.name} | ${color}${r.status}[0m${r.note ? ` (${r.note})` : ""} | ${(r.ms / 1000).toFixed(1)}s |`);
}

// SKIPPED counts as failure for merge purposes (see CLAUDE.md), except when the
// caller explicitly allows it (used by CI matrix jobs that split gates by group).
const allowSkipped = process.env.GATES_ALLOW_SKIPPED === "1";
const failed = results.filter((r) => r.status === "FAIL" || (r.status === "SKIPPED" && !allowSkipped));
if (failed.length) {
  console.log(`\n[31mRED[0m — ${failed.length} gate(s) not passing: ${failed.map((f) => f.name).join(", ")}`);
  process.exit(1);
}
console.log("\n[32mALL GREEN[0m");
