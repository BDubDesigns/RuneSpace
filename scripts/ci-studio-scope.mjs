#!/usr/bin/env node

// Decides whether the `holo-film-studio` CI lane has to do its real work. The
// lane always starts and always reports success or failure, so `Merge gate`
// keeps requiring it like every other lane; this only decides whether its steps
// (npm test, headless Chrome verification, pack check) run.
//
// A pull request runs them only when it changes the studio or the CI that runs
// it. Everything else (pushes to main, manual dispatches, and any case where the
// changed files cannot be determined) runs them, so the lane can only get
// cheaper for a PR that is provably unrelated, never silently skipped.

import { execFileSync } from "node:child_process";
import { appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Studio source, films, engine, player, and tests all live under the first
// entry. The other two are the CI configuration that runs the lane.
export const STUDIO_DIRECTORY = "tools/holo-film-studio/";
export const STUDIO_CI_FILES = [".github/workflows/ci.yml", "scripts/ci-studio-scope.mjs"];

export function isStudioPath(file) {
  return file.startsWith(STUDIO_DIRECTORY) || STUDIO_CI_FILES.includes(file);
}

export function studioScope({ eventName, changedFiles }) {
  if (eventName !== "pull_request") {
    return { run: true, reason: `${eventName || "unknown event"}: the studio lane always runs` };
  }
  if (!changedFiles) {
    return { run: true, reason: "changed files could not be determined" };
  }
  const relevant = changedFiles.filter(isStudioPath);
  if (relevant.length > 0) {
    return {
      run: true,
      reason: `studio or its CI changed (${relevant[0]}, ${relevant.length} file(s))`,
    };
  }
  return {
    run: false,
    reason: `none of ${changedFiles.length} changed file(s) touch the studio or its CI`,
  };
}

// The checkout of a PR is its merge commit: first parent is the base branch,
// second is the PR head, so the first-parent diff is exactly what the PR changes.
// Returns undefined (run everything) for any other shape.
export function pullRequestChangedFiles(git = defaultGit) {
  try {
    const parents = git(["rev-list", "--parents", "-n", "1", "HEAD"]).trim().split(" ").slice(1);
    if (parents.length !== 2) return undefined;
    const names = git(["diff", "--name-only", "--no-renames", "-z", "HEAD^1", "HEAD"]);
    return names.split("\0").filter(Boolean);
  } catch {
    return undefined;
  }
}

function defaultGit(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  const eventName = process.env.EVENT_NAME ?? "";
  const changedFiles = eventName === "pull_request" ? pullRequestChangedFiles() : undefined;
  const { run, reason } = studioScope({ eventName, changedFiles });
  console.log(`[studio-scope] run=${run}: ${reason}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `run=${run}\n`);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const verdict = run ? "ran" : "skipped (unrelated change)";
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `Holo Film Studio checks ${verdict}: ${reason}\n`,
    );
  }
}
