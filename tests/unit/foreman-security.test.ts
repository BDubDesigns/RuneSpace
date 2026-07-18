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
    const dir = join(tmp, "plain");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "deepseek-v4-pro.json"),
      JSON.stringify({
        model: "openai/deepseek-v4-pro",
        api_key: "PLAINTEXT-KEY-MUST-NOT-APPEAR",
        auth_type: "api_key",
        base_url: "https://opencode.ai/zen/go/v1",
      }),
    );
    chmodSync(join(dir, "deepseek-v4-pro.json"), 0o600);
    // Use a tiny temp git repo so the script's `git clone` snapshot is fast and
    // does not pull the entire real RuneSpace tree into the test.
    const fakeRepo = join(tmp, "fakerepo");
    mkdirSync(fakeRepo, { recursive: true });
    execFileSync("git", ["init", "-q", fakeRepo]);
    const { code } = run("bash", [validateScript], {
      ...process.env,
      OPENHANDS_PROFILE_DIR: dir,
      RUNESPACE_REPO: fakeRepo,
      SESSION_API_KEY: "dummy",
    });
    expect(code).not.toBe(0);
  });
});
