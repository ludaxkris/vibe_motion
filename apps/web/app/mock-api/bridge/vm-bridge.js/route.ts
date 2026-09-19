import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { env } from "@/lib/env";

/**
 * Mock-mode stand-in for the API's `GET /bridge/vm-bridge.js`.
 *
 * It serves `packages/bridge/src/vm-bridge.js` — the same file the Gradle
 * `bridgeResources` task copies into the API jar — so the mocked e2e run
 * exercises the real bridge rather than a second copy that could drift
 * (closes the web half of DT-107).
 *
 * The frame's CSP is `script-src 'self'`, and the frame is served from this
 * origin, so the page can load this and nothing else.
 *
 * 404s whenever mocking is off. Not an optimisation: this route reads a file
 * out of the repo, which does not exist in a deployed image, and nothing in a
 * real deployment may serve the bridge from the web origin.
 */
export const dynamic = "force-dynamic";

const CONTENT_TYPE = "application/javascript; charset=utf-8";

/** Where the file sits, relative to a workspace root or to a `node_modules`. */
const CANDIDATES = [
  path.join("packages", "bridge", "src", "vm-bridge.js"),
  path.join("node_modules", "bridge", "src", "vm-bridge.js"),
];

/**
 * Find the script by walking up from the working directory.
 *
 * Not `require.resolve("bridge/vm-bridge.js")`: Turbopack rewrites that call
 * at build time and hands back one of its own virtual module ids
 * (`[project]/packages/bridge/… [app-route] (ecmascript)`), which `readFile`
 * cannot open. A path the bundler never sees, computed from `process.cwd()`,
 * is the one thing that survives both bundlers — and the walk means it does
 * not matter whether the dev server was started from `apps/web` or from the
 * repo root.
 */
async function readBridgeScript(): Promise<string> {
  let dir = process.cwd();
  for (;;) {
    for (const candidate of CANDIDATES) {
      try {
        // `turbopackIgnore`: without it the static analysis cannot scope this
        // path and traces the *whole repo* into the server output, which every
        // production deploy would then carry for a route it can never reach.
        return await readFile(
          /* turbopackIgnore: true */ path.join(/* turbopackIgnore: true */ dir, candidate),
          "utf8",
        );
      } catch {
        // Not here; try the next candidate, then the parent directory.
      }
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error(
        `Could not find packages/bridge/src/vm-bridge.js above ${process.cwd()}; ` +
          "mock mode has to serve the same bridge the API does",
      );
    }
    dir = parent;
  }
}

export async function GET(): Promise<NextResponse> {
  if (!env.apiMocking) return new NextResponse(null, { status: 404 });

  // Read inside the handler, after the gate: a module-scope read would run at
  // build time, in a deployment where the package is not there.
  const source = await readBridgeScript();

  return new NextResponse(source, {
    headers: {
      "content-type": CONTENT_TYPE,
      // Dev only, and edited while the dev server runs; a cached copy would be
      // a bridge version nobody can explain.
      "cache-control": "no-store",
    },
  });
}
