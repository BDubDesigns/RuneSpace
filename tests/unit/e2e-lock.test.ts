import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  ROOT,
  acquireE2eLock,
  isE2eLockOwnerAlive,
  readE2eLockOwner,
  readProcessStartTime,
} from "@/scripts/e2e-shared.mjs";

// Every test uses its own temp lock path; the real host-wide lock is never touched.
let dir: string;
let lockPath: string;
let logs: string[];
const log = (msg: string) => logs.push(msg);
const localEnv = {};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "runespace-e2e-lock-"));
  lockPath = join(dir, "runespace-e2e.lock");
  logs = [];
});

afterEach(() => {
  rmSync(dir, { force: true, recursive: true });
});

function acquire(label: string, options: { maxWaitMs?: number; signal?: AbortSignal } = {}) {
  return acquireE2eLock({ label, log, env: localEnv, path: lockPath, pollMs: 10, ...options });
}

function writeLockRecord(record: unknown) {
  writeFileSync(lockPath, typeof record === "string" ? record : JSON.stringify(record));
}

function exitedPid() {
  return spawnSync(process.execPath, ["-e", ""]).pid;
}

describe("acquireE2eLock", () => {
  it("records its owner and releases idempotently without leaving staging files", async () => {
    const lock = await acquire("canonical-e2e");

    const owner = readE2eLockOwner(lockPath);
    expect(owner).toMatchObject({
      pid: process.pid,
      processStart: readProcessStartTime(process.pid),
      label: "canonical-e2e",
      worktree: ROOT,
      token: lock.owner?.token,
    });
    expect(Number.isNaN(Date.parse(owner!.acquiredAt))).toBe(false);
    expect(readdirSync(dir)).toEqual(["runespace-e2e.lock"]);

    lock.release();
    lock.release();
    expect(existsSync(lockPath)).toBe(false);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("makes a second contender wait for a live owner, then acquire once it releases", async () => {
    const first = await acquire("first");
    let secondSettled = false;
    const second = acquire("second").finally(() => {
      secondSettled = true;
    });

    await sleep(80);
    expect(secondSettled).toBe(false);
    expect(readE2eLockOwner(lockPath)?.label).toBe("first");
    expect(logs).toContainEqual(
      expect.stringMatching(
        new RegExp(
          `^Waiting for the host-wide E2E lock held by PID ${process.pid} \\(first\\) from `,
        ),
      ),
    );
    expect(logs.filter((line) => line.startsWith("Waiting"))).toHaveLength(1);

    first.release();
    const secondLock = await second;
    expect(readE2eLockOwner(lockPath)?.token).toBe(secondLock.owner?.token);
    expect(logs.at(-1)).toMatch(/^Acquired the host-wide E2E lock after waiting/);
    secondLock.release();
  });

  it("never deletes a successor's lock when an earlier owner releases late", async () => {
    const first = await acquire("first");
    unlinkSync(lockPath);
    const second = await acquire("second");

    first.release();

    expect(readE2eLockOwner(lockPath)?.token).toBe(second.owner?.token);
    second.release();
  });

  it("reclaims a lock whose owner process has exited, and says so", async () => {
    const deadPid = exitedPid();
    writeLockRecord({ pid: deadPid, label: "crashed-run", worktree: "/elsewhere" });

    const lock = await acquire("next");

    expect(readE2eLockOwner(lockPath)?.token).toBe(lock.owner?.token);
    expect(logs).toContainEqual(
      expect.stringMatching(
        new RegExp(`^Reclaimed a stale host-wide E2E lock from PID ${deadPid} \\(crashed-run\\)`),
      ),
    );
    lock.release();
  });

  it.skipIf(readProcessStartTime(process.pid) === null)(
    "reclaims a lock whose PID now belongs to a different process",
    async () => {
      writeLockRecord({ pid: process.pid, processStart: "1", label: "reused-pid", worktree: "/x" });

      const lock = await acquire("next");

      expect(readE2eLockOwner(lockPath)?.token).toBe(lock.owner?.token);
      expect(logs).toContainEqual(expect.stringMatching(/^Reclaimed a stale .*\(reused-pid\)/));
      lock.release();
    },
  );

  it("reclaims an unreadable lock record", async () => {
    writeLockRecord("not json");

    const lock = await acquire("next");

    expect(readE2eLockOwner(lockPath)?.token).toBe(lock.owner?.token);
    expect(logs).toContainEqual(expect.stringMatching(/from an unreadable lock record/));
    lock.release();
  });

  it("fails with the holder's identity once the configured wait is exceeded", async () => {
    const first = await acquire("first");

    await expect(acquire("second", { maxWaitMs: 50 })).rejects.toThrow(
      new RegExp(
        `^\\[second\\] FAIL: timed out after .* held by PID ${process.pid} \\(first\\).*RUNESPACE_E2E_LOCK_WAIT_MS`,
      ),
    );
    expect(readE2eLockOwner(lockPath)?.token).toBe(first.owner?.token);
    first.release();
  });

  it("reads the wait limit from RUNESPACE_E2E_LOCK_WAIT_MS and validates it", async () => {
    const first = await acquire("first");
    const wait = (value: string) =>
      acquireE2eLock({
        label: "second",
        log,
        env: { RUNESPACE_E2E_LOCK_WAIT_MS: value },
        path: lockPath,
        pollMs: 10,
      });

    await expect(wait("40")).rejects.toThrow(/timed out/);
    await expect(wait("soon")).rejects.toThrow(
      /RUNESPACE_E2E_LOCK_WAIT_MS must be a positive integer/,
    );
    first.release();
  });

  it("stops waiting promptly when aborted and leaves the holder's lock intact", async () => {
    const first = await acquire("first");
    const controller = new AbortController();
    const second = acquire("second", { signal: controller.signal });

    await sleep(30);
    const abortedAt = Date.now();
    controller.abort(new Error("Received SIGINT"));

    await expect(second).rejects.toThrow("Received SIGINT");
    expect(Date.now() - abortedAt).toBeLessThan(500);
    expect(readE2eLockOwner(lockPath)?.token).toBe(first.owner?.token);
    first.release();
  });

  it("is bypassed on GitHub Actions but still taken locally when CI=true", async () => {
    const onGitHub = await acquireE2eLock({
      label: "ci",
      log,
      env: { GITHUB_ACTIONS: "true", CI: "true" },
      path: lockPath,
    });
    expect(onGitHub.owner).toBeNull();
    expect(existsSync(lockPath)).toBe(false);
    expect(logs).toContainEqual(expect.stringMatching(/GitHub Actions runner/));

    const local = await acquireE2eLock({
      label: "local",
      log,
      env: { CI: "true" },
      path: lockPath,
    });
    expect(readE2eLockOwner(lockPath)?.token).toBe(local.owner?.token);
    local.release();
  });
});

describe("isE2eLockOwnerAlive", () => {
  it("treats the current process as alive and missing or exited owners as dead", () => {
    expect(
      isE2eLockOwnerAlive({ pid: process.pid, processStart: readProcessStartTime(process.pid) }),
    ).toBe(true);
    expect(isE2eLockOwnerAlive({ pid: exitedPid() })).toBe(false);
    expect(isE2eLockOwnerAlive(null)).toBe(false);
    expect(isE2eLockOwnerAlive({ pid: 0 })).toBe(false);
  });
});

// A runner-shaped child: the same createE2eRuntime abort wiring and try/finally
// release the canonical and focused runners use, with a long abortable sleep
// standing in for migrations, build, and Playwright.
const SHARED_MODULE = new URL("../../scripts/e2e-shared.mjs", import.meta.url).href;
const RUNNER_FIXTURE = `
import { setTimeout as sleep } from "node:timers/promises";
import { acquireE2eLock, createE2eRuntime } from ${JSON.stringify(SHARED_MODULE)};
const runtime = createE2eRuntime({ label: "fixture", port: 1, env: process.env, readyTimeoutMs: 1 });
process.once("SIGINT", () => runtime.abort("Received SIGINT"));
process.once("SIGTERM", () => runtime.abort("Received SIGTERM"));
let lock;
try {
  lock = await acquireE2eLock({ label: "fixture", log: runtime.log, signal: runtime.signal, path: process.env.LOCK_PATH, pollMs: 10 });
  if (process.env.FIXTURE_MODE === "fail") throw new Error("simulated runner failure");
  await sleep(60_000, undefined, { signal: runtime.signal }).catch(() => runtime.throwIfAborted());
} catch (error) {
  console.log(error.message);
  process.exitCode = 1;
} finally {
  lock?.release();
}
`;

function startRunner(mode = "hold") {
  const env: NodeJS.ProcessEnv = { ...process.env, LOCK_PATH: lockPath, FIXTURE_MODE: mode };
  delete env.GITHUB_ACTIONS;
  const child = spawn(process.execPath, ["--input-type=module", "-e", RUNNER_FIXTURE], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  const exited = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
    (resolveExit) => child.once("exit", (code, signal) => resolveExit({ code, signal })),
  );

  async function waitForOutput(pattern: RegExp) {
    const deadline = Date.now() + 10_000;
    while (!pattern.test(output)) {
      if (Date.now() > deadline)
        throw new Error(`runner fixture never printed ${pattern}:\n${output}`);
      await sleep(10);
    }
  }

  return { child, exited, waitForOutput, output: () => output };
}

describe("runner lock lifecycle across processes", () => {
  it.each(["SIGINT", "SIGTERM"] as const)("releases a held lock on %s", async (signal) => {
    const runner = startRunner();
    await runner.waitForOutput(/Acquired the host-wide E2E lock/);
    expect(readE2eLockOwner(lockPath)?.pid).toBe(runner.child.pid);

    runner.child.kill(signal);

    expect((await runner.exited).code).toBe(1);
    expect(runner.output()).toContain(`Received ${signal}`);
    expect(existsSync(lockPath)).toBe(false);
  });

  it("releases a held lock when the runner fails", async () => {
    const runner = startRunner("fail");

    expect((await runner.exited).code).toBe(1);
    expect(runner.output()).toContain("simulated runner failure");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("exits promptly on a signal while waiting, without taking the lock", async () => {
    const holder = await acquire("holder");
    const runner = startRunner();
    await runner.waitForOutput(/Waiting for the host-wide E2E lock held by PID \d+ \(holder\)/);

    const signalledAt = Date.now();
    runner.child.kill("SIGTERM");

    expect((await runner.exited).code).toBe(1);
    expect(Date.now() - signalledAt).toBeLessThan(2_000);
    expect(readE2eLockOwner(lockPath)?.token).toBe(holder.owner?.token);
    holder.release();
  });

  it("leaves a stale lock on SIGKILL that the next runner reclaims", async () => {
    const runner = startRunner();
    await runner.waitForOutput(/Acquired the host-wide E2E lock/);
    const killedPid = runner.child.pid;

    runner.child.kill("SIGKILL");
    await runner.exited;
    expect(readE2eLockOwner(lockPath)?.pid).toBe(killedPid);

    const lock = await acquire("next");
    expect(logs).toContainEqual(
      expect.stringMatching(
        new RegExp(`^Reclaimed a stale host-wide E2E lock from PID ${killedPid} \\(fixture\\)`),
      ),
    );
    lock.release();
  });
});
