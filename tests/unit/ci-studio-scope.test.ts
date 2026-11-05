import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { evaluateMergeGate } from "@/scripts/ci-merge-gate.mjs";
import { isStudioPath, pullRequestChangedFiles, studioScope } from "@/scripts/ci-studio-scope.mjs";

// The Holo Film Studio lane always starts and is always required by Merge gate;
// only its expensive steps are scoped (docs/holo-film-studio.md, "CI").
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const SCRIPT = resolve(ROOT, "scripts/ci-studio-scope.mjs");
const WORKFLOW = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8")
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("#"))
  .join("\n");

describe("studio scope decision", () => {
  it.each([
    "tools/holo-film-studio/src/engine/timeline.js",
    "tools/holo-film-studio/src/films/rare-or-weld-done/index.js",
    "tools/holo-film-studio/test/film1-approved.test.mjs",
    "tools/holo-film-studio/package.json",
    ".github/workflows/ci.yml",
    "scripts/ci-studio-scope.mjs",
  ])("runs the studio checks when %s changes", (file) => {
    expect(studioScope({ eventName: "pull_request", changedFiles: ["README.md", file] }).run).toBe(
      true,
    );
  });

  it.each([
    "app/page.tsx",
    "game/missions/index.ts",
    "tests/e2e/smoke.spec.ts",
    "tools/qc-studio/index.ts",
    "tools/holo-film-studio-notes.md",
    "docs/holo-film-studio.md",
    "scripts/ci-merge-gate.mjs",
    "pnpm-lock.yaml",
  ])("skips the studio checks when only %s changes", (file) => {
    const scope = studioScope({ eventName: "pull_request", changedFiles: [file] });
    expect(scope.run).toBe(false);
    expect(isStudioPath(file)).toBe(false);
  });

  it("skips them for an empty pull request diff", () => {
    expect(studioScope({ eventName: "pull_request", changedFiles: [] }).run).toBe(false);
  });

  it("runs them whenever the changed files are unknown, and for main and manual runs", () => {
    expect(studioScope({ eventName: "pull_request", changedFiles: undefined }).run).toBe(true);
    for (const eventName of ["push", "workflow_dispatch", ""]) {
      expect(studioScope({ eventName, changedFiles: ["app/page.tsx"] }).run, eventName).toBe(true);
    }
  });
});

describe("studio scope on a real pull request merge commit", () => {
  const sandboxes: string[] = [];
  afterAll(() => {
    for (const dir of sandboxes) rmSync(dir, { recursive: true, force: true });
  });

  function git(cwd: string, ...args: string[]) {
    return execFileSync(
      "git",
      [
        "-c",
        "user.name=ci",
        "-c",
        "user.email=ci@example.test",
        "-c",
        "commit.gpgsign=false",
        ...args,
      ],
      { cwd, encoding: "utf8" },
    );
  }

  function write(cwd: string, file: string, content: string) {
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), content);
  }

  // Mirrors what actions/checkout gives a PR run: a merge commit of the PR head
  // into a base that may itself have moved on since the PR branched.
  function pullRequestCheckout(prFiles: Record<string, string>, baseMovedOn: string) {
    const cwd = mkdtempSync(join(tmpdir(), "studio-scope-"));
    sandboxes.push(cwd);
    git(cwd, "init", "-q", "-b", "main");
    write(cwd, "README.md", "base\n");
    write(cwd, "tools/holo-film-studio/package.json", "{}\n");
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "-m", "base");
    git(cwd, "checkout", "-q", "-b", "pr");
    for (const [file, content] of Object.entries(prFiles)) write(cwd, file, content);
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "-m", "pr");
    git(cwd, "checkout", "-q", "main");
    // Unrelated and studio-touching base movement must not leak into the PR diff.
    write(cwd, baseMovedOn, "moved\n");
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "-m", "base moved on");
    git(cwd, "merge", "-q", "--no-ff", "-m", "merge pr", "pr");
    return cwd;
  }

  function runScript(cwd: string, eventName: string) {
    const output = join(cwd, "..", `${cwd.split("/").pop()}.out`);
    writeFileSync(output, "");
    execFileSync("node", [SCRIPT], {
      cwd,
      env: { ...process.env, EVENT_NAME: eventName, GITHUB_OUTPUT: output },
    });
    const text = readFileSync(output, "utf8");
    rmSync(output);
    return text.trim();
  }

  it("lists exactly what the pull request changed, not what the base gained", () => {
    const cwd = pullRequestCheckout({ "app/new.tsx": "x\n" }, "tools/holo-film-studio/later.js");
    expect(pullRequestChangedFiles((args) => git(cwd, ...args))).toEqual(["app/new.tsx"]);
  });

  it("does not run the studio checks for an unrelated gameplay change", () => {
    const cwd = pullRequestCheckout(
      { "game/missions/new.ts": "x\n" },
      "tools/holo-film-studio/b.js",
    );
    expect(runScript(cwd, "pull_request")).toBe("run=false");
  });

  it("runs the studio checks when a film changes", () => {
    const cwd = pullRequestCheckout(
      { "tools/holo-film-studio/src/films/rare-or-weld-done/index.js": "x\n" },
      "app/moved.tsx",
    );
    expect(runScript(cwd, "pull_request")).toBe("run=true");
  });

  it("runs the studio checks when the CI configuration changes", () => {
    const cwd = pullRequestCheckout({ ".github/workflows/ci.yml": "x\n" }, "app/moved.tsx");
    expect(runScript(cwd, "pull_request")).toBe("run=true");
  });

  it("runs the studio checks on a main push even when nothing in it is studio-related", () => {
    const cwd = pullRequestCheckout({ "game/missions/new.ts": "x\n" }, "app/moved.tsx");
    expect(runScript(cwd, "push")).toBe("run=true");
  });

  it("fails safe to running them when the checkout is not a merge commit", () => {
    const cwd = mkdtempSync(join(tmpdir(), "studio-scope-"));
    sandboxes.push(cwd);
    git(cwd, "init", "-q", "-b", "main");
    write(cwd, "README.md", "only\n");
    git(cwd, "add", "-A");
    git(cwd, "commit", "-q", "-m", "only");
    expect(pullRequestChangedFiles((args) => git(cwd, ...args))).toBeUndefined();
    expect(runScript(cwd, "pull_request")).toBe("run=true");
  });
});

describe("studio lane in the workflow", () => {
  const start = WORKFLOW.indexOf("\n  holo-film-studio:\n");
  const rest = WORKFLOW.slice(start + 1);
  const lane = rest.slice(0, rest.slice(1).search(/^ {2}[a-z0-9-]+:\n/m) + 1);
  const steps = lane
    .slice(lane.indexOf("    steps:\n"))
    .split(/^ {6}- /m)
    .slice(1);

  it("always starts, so Merge gate can keep requiring it", () => {
    expect(lane).not.toMatch(/^ {4}if:/m);
    expect(lane).not.toMatch(/^ {4}needs:/m);
    // The gate still demands a real success; a skipped studio job would fail it.
    const green = {
      "fast-checks": "success",
      integration: "success",
      "canonical-e2e": "success",
      "canonical-screenshots": "skipped",
    };
    for (const result of ["skipped", "failure", "cancelled"]) {
      const needs = { ...green, "holo-film-studio": result };
      expect(
        evaluateMergeGate(
          Object.fromEntries(Object.entries(needs).map(([k, v]) => [k, { result: v }])),
        ).passed,
      ).toBe(false);
    }
  });

  it("checks out enough history to diff a PR and decides scope before any studio step", () => {
    expect(lane).toContain("fetch-depth: 2");
    const scopeIndex = steps.findIndex((step) => step.includes("id: scope"));
    expect(scopeIndex).toBeGreaterThan(0);
    expect(steps[scopeIndex]).toContain("run: node scripts/ci-studio-scope.mjs");
    expect(steps[scopeIndex]).toContain("EVENT_NAME: ${{ github.event_name }}");
    // The lane's default working directory is the studio; the script lives at the root.
    expect(steps[scopeIndex]).toMatch(/^ {8}working-directory: \.$/m);
  });

  it("gates every Chrome, test, and pack step on that decision", () => {
    const scopeIndex = steps.findIndex((step) => step.includes("id: scope"));
    const studioSteps = steps.slice(scopeIndex + 1);
    expect(studioSteps.map((step) => /run: (.+)/.exec(step)?.[1])).toEqual([
      "google-chrome --version",
      "npm test",
      "npm run verify",
      "npm run pack:check",
    ]);
    for (const step of studioSteps) {
      expect(step).toContain("if: steps.scope.outputs.run == 'true'");
    }
    // Nothing that costs a browser or a test run may sit before the decision.
    for (const step of steps.slice(0, scopeIndex)) {
      expect(step).not.toMatch(/run: (npm|google-chrome)/);
    }
  });

  it("leaves the canonical gameplay E2E lanes untouched by the scope", () => {
    const e2e = rest.slice(rest.indexOf("\n  canonical-e2e:\n"));
    expect(e2e.slice(0, e2e.indexOf("\n  canonical-screenshots:"))).not.toContain("scope");
  });
});
