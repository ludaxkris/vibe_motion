// Proves the immutability gate fails when a published file is edited and passes
// when only a new version is added. Runs against a throwaway git repo so it
// never depends on this repo's history.
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let repo: string;

function git(args: string[], cwd = repo) {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runGate(cwd: string) {
  const r = { code: 0, out: "" };
  try {
    r.out = execFileSync("node", [path.join(cwd, "packages/animation-catalog/scripts/check-immutable.mjs")], {
      cwd,
      encoding: "utf8",
      env: { ...process.env, CATALOG_BASE_REF: "main" },
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (e) {
    const err = e as { status: number; stderr: string; stdout: string };
    r.code = err.status;
    r.out = `${err.stdout}${err.stderr}`;
  }
  return r;
}

beforeEach(() => {
  repo = mkdtempSync(path.join(tmpdir(), "vm-catalog-"));
  const dest = path.join(repo, "packages/animation-catalog");
  cpSync(path.join(pkgRoot, "scripts"), path.join(dest, "scripts"), { recursive: true });
  cpSync(path.join(pkgRoot, "versions"), path.join(dest, "versions"), { recursive: true });
  cpSync(path.join(pkgRoot, "current"), path.join(dest, "current"));
  // scripts import from node_modules via the real package; symlink it in.
  execFileSync("ln", ["-s", path.join(pkgRoot, "node_modules"), path.join(dest, "node_modules")]);
  git(["init", "-q", "-b", "main"]);
  git(["-c", "user.name=t", "-c", "user.email=t@t", "add", "-A"]);
  git(["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base"]);
  git(["checkout", "-q", "-b", "feature"]);
});

afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

describe("check-immutable gate", () => {
  it("passes when nothing changed", () => {
    expect(runGate(repo).code).toBe(0);
  });

  it("passes when a new version is added and current bumped", () => {
    const dir = path.join(repo, "packages/animation-catalog");
    const v1 = JSON.parse(readFileSync(path.join(dir, "versions/1.0.0.json"), "utf8"));
    writeFileSync(path.join(dir, "versions/1.1.0.json"), JSON.stringify({ ...v1, version: "1.1.0" }));
    writeFileSync(path.join(dir, "current"), "1.1.0\n");
    expect(runGate(repo).code).toBe(0);
  });

  it("fails when a published file is edited", () => {
    const file = path.join(repo, "packages/animation-catalog/versions/1.0.0.json");
    const v1 = JSON.parse(readFileSync(file, "utf8"));
    v1.entries[0].description = "edited";
    writeFileSync(file, JSON.stringify(v1));
    const r = runGate(repo);
    expect(r.code).toBe(1);
    expect(r.out).toContain("1.0.0.json");
    expect(r.out).toContain("immutable");
  });

  it("fails when a published file is deleted", () => {
    rmSync(path.join(repo, "packages/animation-catalog/versions/1.0.0.json"));
    const r = runGate(repo);
    expect(r.code).toBe(1);
    expect(r.out).toContain("deleted");
  });
});
