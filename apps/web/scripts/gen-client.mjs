// Regenerates lib/api-client/schema.d.ts from the API contract at apps/api/openapi.yaml.
// Run with `pnpm gen:client`. Never hand-edit the generated file (CLAUDE.md, "Web" conventions).
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import openapiTS, { astToString } from "openapi-typescript";

const here = dirname(fileURLToPath(import.meta.url));
const spec = new URL("../../api/openapi.yaml", import.meta.url);
const out = resolve(here, "../lib/api-client/schema.d.ts");

const header = `/**
 * GENERATED FILE — DO NOT EDIT BY HAND.
 *
 * Source of truth: apps/api/openapi.yaml (the frozen Phase 0 contract).
 * Regenerate with \`pnpm --filter web gen:client\` (or \`pnpm gen:client\` at the repo root).
 * Hand edits will be lost and will silently desynchronise web from the API.
 */

`;

const ast = await openapiTS(spec, { emptyObjectsUnknown: true });

await mkdir(dirname(out), { recursive: true });
await writeFile(out, header + astToString(ast), "utf8");

console.log(`Wrote ${out}`);
