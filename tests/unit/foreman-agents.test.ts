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

      it("is bounded in iterations", () => {
        expect(Number(fm.max_iteration_per_run)).toBeGreaterThan(0);
      });

      it("declares never_confirm (note: NOT read-only enforcement)", () => {
        // `never_confirm` only skips confirmation prompts. True read-only behavior
        // is enforced by: (a) the agent's explicit "read-only" hard constraint in
        // its system prompt, and (b) the validation harness running the agent on an
        // isolated git clone so the real tree cannot be modified. Do not assert
        // never_confirm == read-only.
        expect(fm.permission_mode).toBe("never_confirm");
        const full = readFileSync(resolve(agentsDir, agent.file), "utf8");
        expect(full).toMatch(/read-only/i);
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

describe("Foreman wiring is single-source-of-truth", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../..");
  const validate = readFileSync(
    resolve(repoRoot, "tools/openhands/validate-delegation.sh"),
    "utf8",
  );
  const agentsDir = resolve(repoRoot, ".agents/agents");

  it("validation loads agent defs from .agents/agents (no duplicated prompts)", () => {
    // The script must read the real definition files rather than embedding the
    // advisor/reviewer system prompts. If it duplicated the prose, the unique
    // opening sentence of each agent would appear in the script.
    expect(validate).toMatch(/load_agent_def/);
    expect(validate).toMatch(/\.agents\/agents/);
    const advisorBody = readFileSync(
      resolve(agentsDir, "runespace-hard-problem-advisor.md"),
      "utf8",
    );
    const reviewerBody = readFileSync(resolve(agentsDir, "runespace-reviewer.md"), "utf8");
    // Pull a distinctive phrase from each agent's system prompt.
    const advisorPhrase = "RuneSpace Hard-Problem Advisor";
    const reviewerPhrase = "RuneSpace Reviewer";
    expect(advisorBody).toContain(advisorPhrase);
    expect(reviewerBody).toContain(reviewerPhrase);
    // The validation script must NOT contain those distinctive prose strings.
    expect(validate).not.toContain(advisorPhrase);
    expect(validate).not.toContain(reviewerPhrase);
  });

  it("validation rejects non-Fernet profiles (no plaintext fallback)", () => {
    expect(validate).toMatch(/gAAAAA/);
    expect(validate).not.toMatch(/secrets_encrypted: false/);
    expect(validate).toMatch(/PLAINTEXT keys are forbidden|NOT a Fernet token/);
  });

  it("validation runs specialists on an isolated clone (non-destructive)", () => {
    expect(validate).toMatch(/git clone --local/);
    expect(validate).toMatch(/REAL_REPO_UNCHANGED/);
  });
});

describe("Foreman protocol is auto-loaded by the supported mechanism", () => {
  const here = dirname(fileURLToPath(import.meta.url));
  const repoRoot = resolve(here, "../..");
  const agents = readFileSync(resolve(repoRoot, "AGENTS.md"), "utf8");

  it("root AGENTS.md contains the Foreman protocol section", () => {
    expect(agents).toMatch(/RuneSpace Foreman \(Issue execution\) protocol/);
  });

  it("protocol enforces one-issue, mandatory review, no self-merge", () => {
    expect(agents).toMatch(/One issue only/);
    expect(agents).toMatch(/Mandatory Reviewer/);
    expect(agents).toMatch(/Never merge your own work/);
  });
});

describe("Reviewer verdict extraction", () => {
  // The validation script normalizes the first-line verdict by lower-casing and
  // stripping whitespace, so "not ready" becomes "not-ready".
  const normalize = (v: string) =>
    (v.split("\n")[0] ?? "").trim().toLowerCase().replace(/\s+/g, "-");

  it("accepts the three required verdicts (normalized)", () => {
    const required = ["merge-worthy", "not ready", "blocker found"];
    for (const v of required) {
      expect(["merge-worthy", "not-ready", "blocker-found"]).toContain(normalize(v));
    }
  });

  it("rejects an unknown verdict", () => {
    expect(["merge-worthy", "not-ready", "blocker-found"]).not.toContain(normalize("looks fine"));
  });
});
