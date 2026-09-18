// Proves scripts/validate.mjs's semantic checks for `type: "select"` params: options must be
// non-empty, and default must be one of them. Runs the real script as a subprocess against a
// throwaway copy of the package (mirrors check-immutable.test.ts's approach), so it exercises
// the actual gate CI runs rather than reimplementing its logic.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let dir: string;

function copyPackage(): string {
  const root = mkdtempSync(path.join(tmpdir(), "vm-catalog-validate-"));
  const dest = path.join(root, "packages/animation-catalog");
  cpSync(path.join(pkgRoot, "scripts"), path.join(dest, "scripts"), { recursive: true });
  cpSync(path.join(pkgRoot, "versions"), path.join(dest, "versions"), { recursive: true });
  cpSync(path.join(pkgRoot, "current"), path.join(dest, "current"));
  cpSync(path.join(pkgRoot, "schema.json"), path.join(dest, "schema.json"));
  execFileSync("ln", ["-s", path.join(pkgRoot, "node_modules"), path.join(dest, "node_modules")]);
  return dest;
}

function runValidate(cwd: string) {
  const r = { code: 0, out: "" };
  try {
    r.out = execFileSync("node", ["scripts/validate.mjs"], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    const err = e as { status: number; stderr: string; stdout: string };
    r.code = err.status;
    r.out = `${err.stdout}${err.stderr}`;
  }
  return r;
}

beforeEach(() => {
  dir = copyPackage();
});

afterEach(() => {
  rmSync(path.dirname(path.dirname(dir)), { recursive: true, force: true });
});

describe("validate: type select requires options and a default among them", () => {
  it("passes on the real, unmodified catalog", () => {
    expect(runValidate(dir).code).toBe(0);
  });

  it("fails when a select param's default is not one of its options (typo)", () => {
    const file = path.join(dir, "versions/1.1.0.json");
    const catalog = JSON.parse(readFileSync(file, "utf8"));
    const entry = catalog.entries.find((e: { id: string }) => e.id === "fade-in");
    const fillMode = entry.params.find((p: { key: string }) => p.key === "fillMode");
    fillMode.default = "bothh"; // typo: not in options
    writeFileSync(file, JSON.stringify(catalog));

    const r = runValidate(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("fade-in");
    expect(r.out).toContain("fillMode");
    expect(r.out).toContain("not one of its options");
  });

  it("fails when a select param declares no options", () => {
    const file = path.join(dir, "versions/1.1.0.json");
    const catalog = JSON.parse(readFileSync(file, "utf8"));
    const entry = catalog.entries.find((e: { id: string }) => e.id === "fade-in");
    const fillMode = entry.params.find((p: { key: string }) => p.key === "fillMode");
    fillMode.options = [];
    writeFileSync(file, JSON.stringify(catalog));

    const r = runValidate(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("declares no options");
  });
});

describe("validate: keyframes/baseStyles must stay identical across versions sharing a major", () => {
  it("passes on the real, unmodified catalog (1.0.0 and 1.1.0 are both major 1)", () => {
    expect(runValidate(dir).code).toBe(0);
  });

  it("fails when two versions sharing a major diverge in keyframes for the same id", () => {
    // 1.0.0 and 1.1.0 are both major 1 and both declare "fade-in". keyframesName() encodes only
    // the major version, so if their keyframes ever differ, an editor mixing assignments pinned
    // to each version would collide on one @keyframes rule.
    const file = path.join(dir, "versions/1.1.0.json");
    const catalog = JSON.parse(readFileSync(file, "utf8"));
    const entry = catalog.entries.find((e: { id: string }) => e.id === "fade-in");
    entry.keyframes = "from { opacity: 0.5; } to { opacity: 1; }"; // diverges from 1.0.0's fade-in
    writeFileSync(file, JSON.stringify(catalog));

    const r = runValidate(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("fade-in");
    expect(r.out).toContain("keyframes differ");
    expect(r.out).toContain("would collide");
  });

  it("fails when two versions sharing a major diverge in baseStyles for the same id", () => {
    const file = path.join(dir, "versions/1.1.0.json");
    const catalog = JSON.parse(readFileSync(file, "utf8"));
    const entry = catalog.entries.find((e: { id: string }) => e.id === "scale-in"); // has baseStyles in 1.0.0
    entry.baseStyles = "transform-origin: top left;"; // diverges from 1.0.0's scale-in
    writeFileSync(file, JSON.stringify(catalog));

    const r = runValidate(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("scale-in");
    expect(r.out).toContain("baseStyles differ");
  });
});
