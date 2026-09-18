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

describe("validate: superset gate — a minor/patch release must not drop an id or a param key an earlier release in the same major already published", () => {
  it("passes on the real, unmodified catalog (1.0.0 and 1.1.0 are both major 1)", () => {
    expect(runValidate(dir).code).toBe(0);
  });

  it("fails when a later version in the same major drops an animation id the earlier one declared", () => {
    const file = path.join(dir, "versions/1.1.0.json");
    const catalog = JSON.parse(readFileSync(file, "utf8"));
    catalog.entries = catalog.entries.filter((e: { id: string }) => e.id !== "fade-in");
    writeFileSync(file, JSON.stringify(catalog));

    const r = runValidate(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("fade-in");
    expect(r.out).toContain("missing from 1.1.0");
  });

  it("fails when a later version in the same major drops a param key an earlier one declared for a shared id", () => {
    const file = path.join(dir, "versions/1.1.0.json");
    const catalog = JSON.parse(readFileSync(file, "utf8"));
    const entry = catalog.entries.find((e: { id: string }) => e.id === "fade-in-up");
    entry.params = entry.params.filter((p: { key: string }) => p.key !== "distance");
    // distance was the only var(--vm-distance) reference; drop it from keyframes too so this
    // case only trips the superset gate, not the "cssVar declared but never referenced" check.
    entry.keyframes = entry.keyframes.replaceAll("var(--vm-distance)", "24px");
    writeFileSync(file, JSON.stringify(catalog));

    const r = runValidate(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("fade-in-up");
    expect(r.out).toContain("distance");
    expect(r.out).toContain("missing from 1.1.0");
  });

  it("passes when a later version in the same major adds a new cssVar param and references it in keyframes (the minor case DT-047 exists for)", () => {
    const file = path.join(dir, "versions/1.1.0.json");
    const catalog = JSON.parse(readFileSync(file, "utf8"));
    const entry = catalog.entries.find((e: { id: string }) => e.id === "fade-in");
    entry.params.push({
      key: "tint",
      label: "Tint",
      type: "color",
      default: "currentColor",
      cssVar: "--vm-tint",
    });
    // Default reproduces the previous rendering: color: currentColor is the browser default for
    // opacity-only keyframes, so this is a genuine minor (new optional param, same rendering).
    entry.keyframes = `${entry.keyframes} 0% { color: var(--vm-tint); }`;
    writeFileSync(file, JSON.stringify(catalog));

    expect(runValidate(dir).code).toBe(0);
  });

  it("reports an id dropped in a middle version exactly once across three versions in a major (the relation is transitive)", () => {
    // 1.0.0 -> synthetic 1.0.5 (drops fade-in) -> 1.1.0 (fade-in re-added, which is a legal
    // addition going forward). Only the 1.0.0 -> 1.0.5 pair should ever report fade-in missing;
    // 1.0.5 -> 1.1.0 has nothing to report because 1.0.5 itself doesn't declare fade-in.
    const latest = JSON.parse(readFileSync(path.join(dir, "versions/1.1.0.json"), "utf8"));
    const mid = {
      ...latest,
      version: "1.0.5",
      entries: latest.entries.filter((e: { id: string }) => e.id !== "fade-in"),
    };
    writeFileSync(path.join(dir, "versions/1.0.5.json"), JSON.stringify(mid));

    const r = runValidate(dir);
    expect(r.code).toBe(1);
    const missingFadeInLines = r.out.split("\n").filter((line) => line.includes("fade-in:") && line.includes("missing from"));
    expect(missingFadeInLines).toHaveLength(1);
    expect(missingFadeInLines[0]).toContain("1.0.0/fade-in: missing from 1.0.5");
  });
});

describe("validate: cssVar declared <-> referenced must hold in both directions", () => {
  it("passes on the real, unmodified catalog", () => {
    expect(runValidate(dir).code).toBe(0);
  });

  it("fails when keyframes reference a custom property no param declares via cssVar", () => {
    const file = path.join(dir, "versions/1.1.0.json");
    const catalog = JSON.parse(readFileSync(file, "utf8"));
    const entry = catalog.entries.find((e: { id: string }) => e.id === "fade-in");
    entry.keyframes = `${entry.keyframes} 50% { opacity: var(--vm-ghost); }`;
    writeFileSync(file, JSON.stringify(catalog));

    const r = runValidate(dir);
    expect(r.code).toBe(1);
    expect(r.out).toContain("fade-in");
    expect(r.out).toContain("--vm-ghost");
    expect(r.out).toContain("not declared by any param");
  });
});
