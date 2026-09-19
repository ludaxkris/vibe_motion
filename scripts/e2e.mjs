#!/usr/bin/env node
// `pnpm e2e`: the web e2e specs on a port of this run's own (DT-113). Extra arguments go to
// Playwright: `pnpm e2e --grep editor`.
//
//   VM_E2E_PORT=3210 pnpm e2e                 pin the port yourself
//   VM_E2E_REUSE=1 VM_E2E_PORT=3000 pnpm e2e  attach to the `pnpm dev` YOU started in THIS worktree
//                                             (two `next dev` in one worktree collide on Next's dev lock)
import { spawnSync } from "node:child_process";

import { freePort } from "./free-port.mjs";

const env = { ...process.env };
if (!env.VM_E2E_PORT && !env.GITHUB_ACTIONS) {
  env.VM_E2E_PORT = String(await freePort());
  console.log(`VM_E2E_PORT=${env.VM_E2E_PORT}`);
}
const r = spawnSync("pnpm", ["--filter", "e2e", "test", ...process.argv.slice(2)], { stdio: "inherit", env });
if (r.error) console.error(r.error.message);
process.exit(r.status ?? 1);
