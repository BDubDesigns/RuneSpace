import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Holo Film Studio (issue #489) is a standalone, dependency-free development tool.
// These checks keep it that way from the RuneSpace side; its own film, engine, and
// browser tests run from tools/holo-film-studio/ (see docs/holo-film-studio.md).
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const STUDIO = resolve(ROOT, "tools/holo-film-studio");

function sourceFiles(dir: string, extensions: RegExp): string[] {
  return readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && extensions.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .filter((file) => !file.includes("node_modules"));
}

describe("Holo Film Studio boundary", () => {
  it("keeps the studio package private and free of dependencies", () => {
    const pkg = JSON.parse(readFileSync(join(STUDIO, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(pkg.private).toBe(true);
    for (const field of [
      "dependencies",
      "devDependencies",
      "peerDependencies",
      "optionalDependencies",
    ]) {
      expect(pkg[field], field).toBeUndefined();
    }
    // Nothing for the pnpm install, the Next build, or the Docker image to run.
    expect(existsSync(join(STUDIO, "node_modules"))).toBe(false);
    expect(existsSync(resolve(ROOT, "pnpm-workspace.yaml"))).toBe(false);
  });

  it("is imported by nothing the player build or the app ships", () => {
    const shipped = [
      "app",
      "components",
      "features",
      "game",
      "server",
      "db",
      "minigames",
      "tools/qc-studio",
    ];
    const rootFiles = readdirSync(ROOT).filter((name) => /\.(ts|tsx|mjs)$/.test(name));
    const files = [
      ...shipped.flatMap((dir) => sourceFiles(resolve(ROOT, dir), /\.(ts|tsx|js|mjs)$/)),
      ...rootFiles.map((name) => join(ROOT, name)),
    ].filter((file) => !file.endsWith("eslint.config.mjs"));
    expect(files.length).toBeGreaterThan(100);
    const importers = files.filter((file) => /holo-film-studio/.test(readFileSync(file, "utf8")));
    expect(importers).toEqual([]);
  });

  it("imports only its own files and Node built-ins, with no framework reaching in", () => {
    const files = ["src", "dev", "test"].flatMap((dir) =>
      sourceFiles(resolve(STUDIO, dir), /\.(js|mjs)$/),
    );
    files.push(join(STUDIO, "script.js"));
    expect(files.length).toBeGreaterThan(30);
    const specifier = /(?:from\s+|import\s*\(\s*|import\s+)['"]([^'"]+)['"]/g;
    const offenders: string[] = [];
    for (const file of files) {
      for (const match of readFileSync(file, "utf8").matchAll(specifier)) {
        const target = match[1]!;
        if (target.startsWith("node:")) continue;
        if (!target.startsWith("./") && !target.startsWith("../")) {
          offenders.push(`${file}: ${target}`);
          continue;
        }
        if (!resolve(dirname(file), target).startsWith(STUDIO))
          offenders.push(`${file}: ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it("stays out of formatting, linting, and the production image context", () => {
    const listed = (name: string) =>
      readFileSync(resolve(ROOT, name), "utf8")
        .split("\n")
        .map((line) => line.trim());
    expect(listed(".prettierignore")).toContain("tools/holo-film-studio");
    expect(listed(".dockerignore")).toContain("tools/holo-film-studio");
    expect(readFileSync(resolve(ROOT, "eslint.config.mjs"), "utf8")).toContain(
      '"tools/holo-film-studio/**"',
    );
  });

  it("has a focused CI lane that runs the studio's own checks from its directory", () => {
    const workflow = readFileSync(resolve(ROOT, ".github/workflows/ci.yml"), "utf8")
      .split("\n")
      .filter((line) => !line.trimStart().startsWith("#"))
      .join("\n");
    const start = workflow.indexOf("\n  holo-film-studio:\n");
    expect(start).toBeGreaterThan(-1);
    const rest = workflow.slice(start + 1);
    const next = rest.slice(1).search(/^ {2}[a-z0-9-]+:\n/m);
    const lane = next === -1 ? rest : rest.slice(0, next + 1);
    expect(lane).toContain("working-directory: tools/holo-film-studio");
    for (const command of ["npm test", "npm run verify", "npm run pack:check"]) {
      expect(lane, command).toContain(`run: ${command}`);
    }
    // No database and no app install: this lane must not depend on the game.
    expect(lane).not.toMatch(/postgres|pnpm|DATABASE_URL/i);
  });
});
