import { describe, expect, it, afterAll } from "vitest";
import { execFileSync, execFile } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, chmodSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Security / fail-safe behavior for the Foreman tooling. These tests exercise the
 * bash scripts directly (no network, no real secrets) to prove:
 *  - create-profiles.sh refuses to run without OH_SECRET_KEY (no plaintext key)
 *  - create-profiles.sh writes Fernet-encrypted keys at mode 0600
 *  - validate-delegation.sh rejects a plaintext profile (no secrets_encrypted:false)
 */

const repoRoot = join(import.meta.dirname, "../..");
const createScript = join(repoRoot, "tools/openhands/create-profiles.sh");
const validateScript = join(repoRoot, "tools/openhands/validate-delegation.sh");

const tmp = mkdtempSync(join(tmpdir(), "foreman-sec-"));
afterAll(() => rmSync(tmp, { recursive: true, force: true }));

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv): { code: number; out: string } {
  try {
    const out = execFileSync(cmd, args, { env, encoding: "utf8" });
    return { code: 0, out };
  } catch (e: any) {
    return { code: e.status ?? 1, out: (e.stdout ?? "") + (e.stderr ?? "") };
  }
}

describe("create-profiles.sh secret handling", () => {
  it("aborts when OH_SECRET_KEY is missing (no plaintext fallback)", () => {
    const { code, out } = run("bash", [createScript], {
      ...process.env,
      OH_SECRET_KEY: "",
      OPENCODE_API_KEY: "dummy",
      OPENHANDS_PROFILE_DIR: tmp,
    });
    expect(code).not.toBe(0);
    expect(out).toMatch(/OH_SECRET_KEY is required/);
  });

  it("writes a Fernet-encrypted key (gAAAAA) at mode 0600", () => {
    const dir = join(tmp, "enc");
    mkdirSync(dir, { recursive: true });
    const { code, out } = run("bash", [createScript], {
      ...process.env,
      OH_SECRET_KEY: "0".repeat(64),
      OPENCODE_API_KEY: "test-key-value",
      OPENHANDS_PROFILE_DIR: dir,
      OPENCODE_GO_BASE_URL: "https://opencode.ai/zen/go/v1",
      OPENCODE_ZEN_BASE_URL: "https://opencode.ai/zen/v1",
    });
    expect(code).toBe(0);
    const prof = join(dir, "deepseek-v4-pro.json");
    // mode 0600
    const mode = (require("node:fs").statSync(prof).mode & 0o777).toString(8);
    expect(mode).toBe("600");
    const apiKey = JSON.parse(require("node:fs").readFileSync(prof, "utf8")).api_key;
    expect(apiKey.startsWith("gAAAAA")).toBe(true);
    // plaintext must not appear
    expect(out).not.toContain("test-key-value");
  });
});

describe("validate-delegation.sh profile rejection", () => {
  it("rejects a profile whose api_key is not a Fernet token", () => {
    // Build a *valid* temporary git repo that satisfies the script's
    // preconditions: it has at least one commit and the real .agents/agents
    // definitions (so the script reaches the profile check instead of failing
    // earlier on missing agent defs).
    const fakeRepo = join(tmp, "fakerepo");
    mkdirSync(fakeRepo, { recursive: true });
    execFileSync("git", ["init", "-q", fakeRepo]);
    execFileSync("git", ["-C", fakeRepo, "config", "user.email", "test@example.com"]);
    execFileSync("git", ["-C", fakeRepo, "config", "user.name", "test"]);
    // Copy the real agent definitions so load_agent_def succeeds.
    const agentsSrc = join(repoRoot, ".agents/agents");
    const agentsDst = join(fakeRepo, ".agents/agents");
    mkdirSync(agentsDst, { recursive: true });
    for (const f of ["runespace-hard-problem-advisor.md", "runespace-reviewer.md"]) {
      writeFileSync(join(agentsDst, f), require("node:fs").readFileSync(join(agentsSrc, f)));
    }
    writeFileSync(join(fakeRepo, "README.md"), "# fake\n");
    execFileSync("git", ["-C", fakeRepo, "add", "-A"]);
    execFileSync("git", ["-C", fakeRepo, "commit", "-qm", "init"]);

    // validate-delegation.sh reads profiles from $HOME/.openhands/profiles, so
    // point HOME at a temp dir and drop a plaintext (non-Fernet) profile there.
    // It also creates an isolated snapshot under $HOME/workspace, so that dir
    // must exist for the script to reach the profile check.
    const home = join(tmp, "home");
    mkdirSync(join(home, "workspace"), { recursive: true });
    const profDir = join(home, ".openhands/profiles");
    mkdirSync(profDir, { recursive: true });
    writeFileSync(
      join(profDir, "deepseek-v4-pro.json"),
      JSON.stringify({
        model: "openai/deepseek-v4-pro",
        api_key: "PLAINTEXT-KEY-MUST-NOT-APPEAR",
        auth_type: "api_key",
        base_url: "https://opencode.ai/zen/go/v1",
      }),
    );
    chmodSync(join(profDir, "deepseek-v4-pro.json"), 0o600);

    const { code, out } = run("bash", [validateScript], {
      ...process.env,
      HOME: home,
      RUNESPACE_REPO: fakeRepo,
      SESSION_API_KEY: "dummy",
    });
    expect(code).not.toBe(0);
    // The rejection must come specifically from the Fernet-token check, not from
    // some unrelated precondition (e.g. missing agent defs).
    expect(out).toMatch(/not a Fernet token/i);
  });
});
