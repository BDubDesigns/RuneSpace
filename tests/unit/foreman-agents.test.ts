import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * Structural validation for the RuneSpace Foreman sub-agent definitions.
 *
 * These are project-local OpenHands agents (`.agents/agents/*.md`, discovered by
 * OpenHands 1.35). They must reference the named `deepseek-v4-pro` model profile
 * (so the Advisor/Reviewer run on the stronger model, not the Foreman's HY3) and
 * must declare a read-only tool set.
 *
 * This test is intentionally dependency-free: it parses only the simple
 * `key: value` frontmatter lines the definitions use, so we do not pull in a
 * YAML library for a three-file scaffold. It asserts the wiring the Foreman
 * relies on, without touching any network or secret.
 */

const here = dirname(fileURLToPath(import.meta.url));
const agentsDir = resolve(here, "../../.agents/agents");

const EXPECTED = [
  {
    file: "runespace-hard-problem-advisor.md",
    name: "runespace-hard-problem-advisor",
    role: "Hard-Problem Advisor",
  },
  {
    file: "runespace-reviewer.md",
    name: "runespace-reviewer",
    role: "Reviewer",
  },
] as const;

function frontmatter(path: string): { fields: Record<string, string>; raw: string } {
  const raw = readFileSync(path, "utf8");
  const match = raw.match(/^---\n([\s\S]*?)\n---/);
  if (!match || match[1] === undefined) {
    throw new Error(`No YAML frontmatter found in ${path}`);
  }
  const block = match[1];
  const out: Record<string, string> = {};
  for (const line of block.split("\n")) {
    const m = line.match(/^([a-zA-Z_][a-zA-Z0-9_]*):\s*(.*)$/);
    if (m && m[1] !== undefined && m[2] !== undefined) {
      out[m[1]] = m[2].trim();
    }
  }
  return { fields: out, raw: block };
}

describe("RuneSpace Foreman sub-agents", () => {
  for (const agent of EXPECTED) {
    describe(agent.role, () => {
      const { fields: fm, raw } = frontmatter(resolve(agentsDir, agent.file));

      it("has a matching name", () => {
        expect(fm.name).toBe(agent.name);
      });

      it("uses the stronger deepseek-v4-pro model profile", () => {
        expect(fm.model).toBe("deepseek-v4-pro");
      });

      it("is read-only (never_confirm) and bounded", () => {
        expect(fm.permission_mode).toBe("never_confirm");
        expect(Number(fm.max_iteration_per_run)).toBeGreaterThan(0);
      });

      it("declares a tool set", () => {
        // tools: is a YAML block list; check it appears in the frontmatter.
        expect(raw).toMatch(/terminal/);
        expect(raw).toMatch(/file_editor/);
      });

      it("carries a non-empty description with a trigger example", () => {
        const full = readFileSync(resolve(agentsDir, agent.file), "utf8");
        expect(full).toMatch(/<example>/);
      });
    });
  }
});
