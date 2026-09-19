#!/usr/bin/env node
// Vibe Motion quality gates. This is what CI runs and what every agent runs
// before marking a PR ready. Usage: node scripts/gates.mjs [web|api|catalog|bridge|e2e|e2e-docker|all]
//
// Every gate runs even if an earlier one fails, so a single run reports the
// full picture. Exit code is non-zero if any gate failed.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { freePort } from "./free-port.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const group = process.argv[2] ?? "all";

const gates = [
  // ---- catalog -------------------------------------------------------------
  { group: "catalog", name: "catalog validate", cmd: "pnpm", args: ["--filter", "animation-catalog", "validate"] },
  { group: "catalog", name: "catalog immutable", cmd: "pnpm", args: ["--filter", "animation-catalog", "check-immutable"] },
  { group: "catalog", name: "catalog typecheck", cmd: "pnpm", args: ["--filter", "animation-catalog", "typecheck"] },
  { group: "catalog", name: "catalog test", cmd: "pnpm", args: ["--filter", "animation-catalog", "test"] },
  // Generated artifacts (catalog TS types, web API client) must be committed in sync with
  // their sources, otherwise a contract edit can silently leave another app on a stale client.
  { group: "catalog", name: "generated artifacts up to date", cmd: "node", args: ["scripts/check-generated.mjs"] },
  // ---- bridge --------------------------------------------------------------
  // `typecheck` runs tsc with checkJs over src/vm-bridge.js, so the plain browser script is
  // type-checked against protocol.ts through its JSDoc imports even though it never imports it.
  { group: "bridge", name: "bridge typecheck", cmd: "pnpm", args: ["--filter", "bridge", "typecheck"] },
  { group: "bridge", name: "bridge test", cmd: "pnpm", args: ["--filter", "bridge", "test"] },
  // Real-browser specs for what jsdom structurally cannot see: real animations, real layout, a
  // real IntersectionObserver and a real cascade. No app and no API: the parent page, the framed
  // page and the script are all fulfilled by `page.route` on three different origins.
  { group: "bridge", name: "bridge e2e (playwright)", cmd: "pnpm", args: ["--filter", "bridge", "e2e"] },
  // ---- web -----------------------------------------------------------------
  { group: "web", name: "web lint", cmd: "pnpm", args: ["--filter", "web", "lint"] },
  { group: "web", name: "web typecheck", cmd: "pnpm", args: ["--filter", "web", "typecheck"] },
  { group: "web", name: "web unit", cmd: "pnpm", args: ["--filter", "web", "test"] },
  { group: "web", name: "web build", cmd: "pnpm", args: ["--filter", "web", "build"] },
  // ---- api -----------------------------------------------------------------
  { group: "api", name: "api check (ktlint + kotest)", cmd: "./gradlew", args: ["check", "--no-daemon", "--console=plain"], cwd: "apps/api" },
  { group: "api", name: "api docker build", cmd: "docker", args: ["build", "-q", "-f", "apps/api/Dockerfile", "-t", "vibe-motion-api:gate", "."], requires: "docker" },
  // ---- e2e -----------------------------------------------------------------
  { group: "e2e", name: "e2e typecheck", cmd: "pnpm", args: ["--filter", "e2e", "typecheck"] },
  { group: "e2e", name: "web e2e (playwright)", cmd: "pnpm", args: ["--filter", "e2e", "test"], freePort: "VM_E2E_PORT" },
  // Full stack (db + api image + production web build) in a throwaway, per-run Docker stack.
  { group: "e2e-docker", name: "full-stack e2e (docker)", cmd: "scripts/e2e-docker.sh", args: [], requires: "docker" },
];

const selected = gates.filter((g) => group === "all" || g.group === group);
if (selected.length === 0) {
  console.error(`Unknown gate group "${group}". Use web | api | catalog | bridge | e2e | e2e-docker | all.`);
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
    const env = { ...process.env };
    // Worktrees run gates side by side on one machine, so the web e2e gate must not depend on
    // (or attach to) a fixed :3000 (DT-113). A caller-pinned port is respected; GitHub's runners
    // are one job each and keep the default.
    if (g.freePort && !env[g.freePort] && !env.GITHUB_ACTIONS) {
      try {
        env[g.freePort] = String(await freePort());
        console.log(`  ${g.freePort}=${env[g.freePort]}`);
      } catch (error) {
        // Never lose the summary of the gates that already ran over a failed probe.
        note = `no free port: ${error.message}`;
      }
    }
    const r = spawnSync(g.cmd, g.args, { cwd, stdio: "inherit", env, shell: false });
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
