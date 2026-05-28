import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import {
  listProjects, importProject, deriveProjectName, isWorkspaceProject,
} from "../src/web/workspace.js";

function emptyWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "lanes-ws-"));
}

// Make a fake project directory that *looks like* a git repo (presence of .git/
// is the classification signal we use; we don't need a real one for these tests).
function fakeProject(ws: string, name: string, opts: { initialised?: boolean; summary?: string } = {}): string {
  const p = join(ws, name);
  mkdirSync(join(p, ".git"), { recursive: true });
  if (opts.initialised) {
    mkdirSync(join(p, ".lanes"));
    writeFileSync(join(p, ".lanes/summary.md"), opts.summary ?? `# ${name}\n\nA fake project.\n`);
  }
  return p;
}

describe("deriveProjectName", () => {
  it("handles https URLs", () => {
    expect(deriveProjectName("https://github.com/foo/bar")).toBe("bar");
    expect(deriveProjectName("https://github.com/foo/bar.git")).toBe("bar");
    expect(deriveProjectName("https://github.com/foo/bar/")).toBe("bar");
  });
  it("handles SSH URLs", () => {
    expect(deriveProjectName("git@github.com:foo/bar.git")).toBe("bar");
  });
  it("handles local paths", () => {
    expect(deriveProjectName("/local/path/to/repo")).toBe("repo");
    expect(deriveProjectName("/local/path/to/repo.git")).toBe("repo");
  });
  it("returns empty on empty/whitespace input", () => {
    expect(deriveProjectName("")).toBe("");
    expect(deriveProjectName("   ")).toBe("");
  });
});

describe("listProjects", () => {
  it("returns empty when workspace doesn't exist", () => {
    expect(listProjects("/nonexistent/path/xyz")).toEqual([]);
  });

  it("returns empty for an empty workspace", () => {
    expect(listProjects(emptyWorkspace())).toEqual([]);
  });

  it("classifies projects as initialised or uninitialised", () => {
    const ws = emptyWorkspace();
    fakeProject(ws, "alpha", { initialised: false });
    fakeProject(ws, "beta", { initialised: true });
    const projects = listProjects(ws);
    expect(projects).toHaveLength(2);
    expect(projects.map((p) => [p.name, p.class])).toEqual([
      ["alpha", "uninitialised"],
      ["beta", "initialised"],
    ]);
  });

  it("skips subdirectories without .git/", () => {
    const ws = emptyWorkspace();
    mkdirSync(join(ws, "not-a-repo"));
    fakeProject(ws, "real", { initialised: false });
    expect(listProjects(ws).map((p) => p.name)).toEqual(["real"]);
  });

  it("extracts first paragraph from summary.md for initialised projects, stripping the H1", () => {
    const ws = emptyWorkspace();
    fakeProject(ws, "p", {
      initialised: true,
      summary: "# p\n\nA short cover paragraph describing it.\n\nLater details that should NOT appear.\n",
    });
    expect(listProjects(ws)[0].summary).toBe("A short cover paragraph describing it.");
  });

  it("returns alphabetically sorted by name", () => {
    const ws = emptyWorkspace();
    fakeProject(ws, "gamma");
    fakeProject(ws, "alpha");
    fakeProject(ws, "beta");
    expect(listProjects(ws).map((p) => p.name)).toEqual(["alpha", "beta", "gamma"]);
  });
});

describe("isWorkspaceProject", () => {
  it("true for an existing repo subdir", () => {
    const ws = emptyWorkspace();
    fakeProject(ws, "p");
    expect(isWorkspaceProject(ws, "p")).toBe(true);
  });
  it("false for a non-existent name", () => {
    expect(isWorkspaceProject(emptyWorkspace(), "missing")).toBe(false);
  });
  it("false for a subdir lacking .git", () => {
    const ws = emptyWorkspace();
    mkdirSync(join(ws, "not-repo"));
    expect(isWorkspaceProject(ws, "not-repo")).toBe(false);
  });
});

describe("importProject", () => {
  // git clone needs an actual git source. We create a local bare repo and clone
  // from it — fast, no network, exercises the real code path.
  function makeBareSource(): string {
    const src = mkdtempSync(join(tmpdir(), "lanes-src-"));
    spawnSync("git", ["init", "--bare", "-q", src], { stdio: "ignore" });
    // Need at least one commit for clone to succeed without --allow-empty headache.
    const work = mkdtempSync(join(tmpdir(), "lanes-srcwork-"));
    spawnSync("git", ["clone", "-q", src, work], { stdio: "ignore" });
    spawnSync("git", ["-C", work, "config", "user.email", "test@example.com"], { stdio: "ignore" });
    spawnSync("git", ["-C", work, "config", "user.name", "Test"], { stdio: "ignore" });
    spawnSync("git", ["-C", work, "config", "commit.gpgsign", "false"], { stdio: "ignore" });
    writeFileSync(join(work, "README.md"), "# src\n");
    spawnSync("git", ["-C", work, "add", "."], { stdio: "ignore" });
    spawnSync("git", ["-C", work, "commit", "-q", "-m", "initial"], { stdio: "ignore" });
    spawnSync("git", ["-C", work, "push", "-q"], { stdio: "ignore" });
    return src;
  }

  it("clones into the workspace and returns the derived name+path", () => {
    const src = makeBareSource();
    const ws = emptyWorkspace();
    const result = importProject(ws, src);
    expect(result.name).toBe(deriveProjectName(src));
    expect(result.path).toBe(join(ws, result.name));
    expect(listProjects(ws).map((p) => p.name)).toContain(result.name);
  });

  it("throws when the workspace dir doesn't exist", () => {
    const src = makeBareSource();
    expect(() => importProject("/does/not/exist/here", src)).toThrow(/does not exist/);
  });

  it("throws when a project of that name already exists in the workspace", () => {
    const src = makeBareSource();
    const ws = emptyWorkspace();
    importProject(ws, src);
    expect(() => importProject(ws, src)).toThrow(/already exists/);
  });

  it("throws when git clone fails (e.g. bad URL)", () => {
    const ws = emptyWorkspace();
    expect(() => importProject(ws, "/does/not/exist/source-xyz")).toThrow(/git clone failed/);
  });
});
