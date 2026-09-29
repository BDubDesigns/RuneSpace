// Shared primitives for the RuneSpace local production E2E runners.
//
// This module is the single home for the small, behavior-identical pieces the
// canonical runner (scripts/run-canonical-e2e.mjs) and the focused runner
// (scripts/run-focused-e2e.mjs) both need: validation guards, port checks, and
// targeted process termination. It is NOT a generic E2E framework; the
// per-runner environment map, phase sequencing, and cleanup-path selection
// stay in each runner.
//
// The process supervisor glue shared by both runners (command execution,
// production server startup, readiness polling, owned-child teardown) lives in
// createE2eRuntime, parameterized by label/port/env so each runner keeps its
// own log and failure prefix.
//
// acquireE2eLock is the host-wide lock (issue #251) that serializes local
// runners across worktrees, so only one production-style E2E lifecycle uses
// the shared host at a time.

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { linkSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { resolve, dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PACKAGE_MANAGER = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

// The local-database safety rule lives in one authoritative place
// (scripts/local-db-url.mjs) and is re-exported here so the canonical and
// focused runners keep their existing import surface while always using the
// strengthened validator.
export { assertLocalDatabaseUrl } from "./local-db-url.mjs";

/**
 * The fixed Better Auth user id the admin/operator browser specs seed and sign
 * in as (`tests/e2e/admin-session.ts` `ADMIN_USER_ID`). Both local runners put
 * it on the server-only admin allowlist so operator journeys run; it is a
 * loopback test identity, never a real operator.
 */
export const E2E_ADMIN_USER_IDS = "00000000-0000-0000-0000-0000000000a1";

/**
 * The account-boundary settings every local production E2E server needs
 * (issue #221): test-only Turnstile keys, Turnstile site verification
 * redirected to the server's own loopback stub, and a run-scoped outbox file
 * that captures verification mail. The server honors the redirect and the
 * outbox only inside its local-E2E gate (CI + plain-HTTP runner flag +
 * loopback database), so no browser journey ever calls Cloudflare or
 * ZeptoMail. Specs read the outbox path from the same variable.
 */
export function accountBoundaryE2eEnv({ port, runId }) {
  return {
    TURNSTILE_SITE_KEY: "e2e-turnstile-site-key",
    TURNSTILE_SECRET_KEY: "e2e-turnstile-secret-not-for-production",
    RUNESPACE_E2E_TURNSTILE_SITEVERIFY_URL: `http://127.0.0.1:${port}/api/e2e/turnstile-siteverify`,
    RUNESPACE_E2E_MAIL_OUTBOX_FILE: resolve(ROOT, ".playwright", `mail-outbox-${runId}.jsonl`),
  };
}

export function readPositiveInteger(value, fallback, label) {
  if (value === undefined || value === null || value === "") return fallback;
  // The whole value must be an integer representation; parseInt would silently
  // accept "1024.5" or "1025junk", violating the validated-integer contract.
  if (!/^\d+$/.test(value)) {
    throw new Error(`${label} must be a positive integer, got ${value}`);
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer, got ${value}`);
  }
  return parsed;
}

export function fail(msg) {
  throw new Error(`[runespace-e2e] FAIL: ${msg}`);
}

export function readPositiveDuration(value, fallback) {
  return readPositiveInteger(value, fallback, "Duration");
}

export function isRunning(child) {
  return Boolean(child) && child.exitCode === null && child.signalCode === null;
}

export function waitForClose(child, timeoutMs) {
  if (!isRunning(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    let timer;
    const onClose = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("close", onClose);
    timer = setTimeout(() => {
      child.removeListener("close", onClose);
      resolve(!isRunning(child));
    }, timeoutMs);
  });
}

/**
 * Terminates ONLY the given child (and its process group on POSIX). Never
 * used to guess ownership: callers pass the exact child they spawned, and
 * behavior is safe when the process already exited (ESRCH is ignored).
 * An optional logger restores runner-scoped shutdown diagnostics.
 */
export async function terminateProcess(child, label, log) {
  if (!isRunning(child)) return;

  const sendSignal = (signal) => {
    try {
      if (process.platform !== "win32" && child.pid) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch (error) {
      if (error?.code !== "ESRCH") throw error;
    }
  };

  if (log) log(`Stopping ${label}...`);
  sendSignal("SIGTERM");
  if (await waitForClose(child, 5_000)) return;
  if (log) log(`Stopping ${label} forcefully...`);
  sendSignal("SIGKILL");
  await waitForClose(child, 5_000);
}

export function assertPortAvailable(port) {
  return new Promise((resolvePort, rejectPort) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    let settled = false;
    const settle = (callback, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      callback(value);
    };

    socket.once("connect", () =>
      settle(rejectPort, new Error(`dedicated test port ${port} is already in use`)),
    );
    socket.once("error", (error) => {
      if (error.code === "ECONNREFUSED") settle(resolvePort);
      else settle(rejectPort, error);
    });
    socket.setTimeout(1_000, () =>
      settle(rejectPort, new Error(`could not verify that test port ${port} is available`)),
    );
  });
}

export function assertNode22(version = process.versions.node) {
  if (!version.startsWith("22.")) {
    throw new Error(`Node 22.x required, found ${version}`);
  }
}

// A fixed path rather than os.tmpdir(): TMPDIR can differ between sessions on
// the same host, and the lock only works if every runner agrees on one file.
export const E2E_LOCK_PATH =
  process.platform === "win32" ? join(tmpdir(), "runespace-e2e.lock") : "/tmp/runespace-e2e.lock";
export const DEFAULT_E2E_LOCK_WAIT_MS = 60 * 60_000;
export const E2E_LOCK_POLL_MS = 5_000;
const E2E_LOCK_PROGRESS_MS = 5 * 60_000;

/** Kernel start time of a process (field 22 of /proc/<pid>/stat), or null where unavailable. */
export function readProcessStartTime(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Field 2 (comm) may contain spaces, so count fields after its closing paren.
    return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19] ?? null;
  } catch {
    return null;
  }
}

/** True while the recorded owner process still exists and is the same process (not a reused PID). */
export function isE2eLockOwnerAlive(owner) {
  if (!owner || !Number.isInteger(owner.pid) || owner.pid <= 0) return false;
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (error.code !== "EPERM") return false;
  }
  if (!owner.processStart) return true;
  const current = readProcessStartTime(owner.pid);
  return current === null || current === owner.processStart;
}

function readLockFile(path) {
  let raw;
  try {
    raw = readFileSync(path, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  try {
    return { raw, owner: JSON.parse(raw) };
  } catch {
    return { raw, owner: null };
  }
}

/** The current lock owner's metadata, or null when the lock is free or unreadable. */
export function readE2eLockOwner(path = E2E_LOCK_PATH) {
  return readLockFile(path)?.owner ?? null;
}

function tryCreateLockFile(path, raw) {
  // link() publishes a fully written file atomically and fails if the lock
  // exists, so readers never observe a partially written owner record.
  const staging = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(staging, raw, { encoding: "utf8", flag: "wx" });
  try {
    linkSync(staging, path);
    return true;
  } catch (error) {
    if (error.code === "EEXIST") return false;
    throw error;
  } finally {
    unlinkSync(staging);
  }
}

function reclaimStaleLockFile(path, staleRaw) {
  // Move the file aside before deleting it, then confirm it is the stale record
  // that was judged dead. Another contender may already have reclaimed it and
  // acquired a fresh lock in between; that live lock is put back untouched.
  const aside = `${path}.stale-${process.pid}-${randomUUID()}`;
  try {
    renameSync(path, aside);
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  const movedRaw = readLockFile(aside)?.raw;
  if (movedRaw === staleRaw) {
    unlinkSync(aside);
    return true;
  }
  try {
    linkSync(aside, path);
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  unlinkSync(aside);
  return false;
}

function releaseLockFile(path, raw) {
  if (readLockFile(path)?.raw !== raw) return;
  try {
    unlinkSync(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function formatDuration(ms) {
  return ms < 120_000
    ? `${Math.max(0, Math.round(ms / 1_000))}s`
    : `${Math.round(ms / 60_000)} min`;
}

function describeLockOwner(owner, nowMs) {
  if (!owner) return "an unreadable lock record";
  const acquiredAt = Date.parse(owner.acquiredAt);
  const age = Number.isNaN(acquiredAt) ? "" : `, held for ${formatDuration(nowMs - acquiredAt)}`;
  return `PID ${owner.pid} (${owner.label}) from ${owner.worktree}${age}`;
}

/**
 * Waits for and takes the host-wide local E2E lock, so only one canonical or
 * focused runner performs migrations, build, server, and Playwright at a time
 * across every worktree on the host. GitHub Actions runners are isolated
 * machines and skip it. The caller must invoke release() in its cleanup path.
 */
export async function acquireE2eLock({
  label,
  log,
  signal,
  env = process.env,
  path = E2E_LOCK_PATH,
  maxWaitMs = readPositiveInteger(
    env.RUNESPACE_E2E_LOCK_WAIT_MS,
    DEFAULT_E2E_LOCK_WAIT_MS,
    "RUNESPACE_E2E_LOCK_WAIT_MS",
  ),
  pollMs = E2E_LOCK_POLL_MS,
}) {
  // Keyed on GITHUB_ACTIONS, never CI: both local runners deliberately set
  // CI=true in their child environment for CI parity.
  if (env.GITHUB_ACTIONS === "true") {
    log("GitHub Actions runner: the host-wide local E2E lock is not used.");
    return { owner: null, release() {} };
  }

  const owner = {
    pid: process.pid,
    processStart: readProcessStartTime(process.pid),
    label,
    worktree: ROOT,
    acquiredAt: new Date().toISOString(),
    token: randomUUID(),
  };
  const raw = `${JSON.stringify(owner)}\n`;
  const startedAt = Date.now();
  let reportedRaw = null;
  let lastReportAt = 0;

  for (;;) {
    if (signal?.aborted) throw signal.reason;
    if (tryCreateLockFile(path, raw)) {
      log(
        reportedRaw === null
          ? `Acquired the host-wide E2E lock (${path}).`
          : `Acquired the host-wide E2E lock after waiting ${formatDuration(Date.now() - startedAt)}.`,
      );
      return { owner, release: () => releaseLockFile(path, raw) };
    }

    const current = readLockFile(path);
    if (current === null) continue;
    if (!isE2eLockOwnerAlive(current.owner)) {
      if (reclaimStaleLockFile(path, current.raw)) {
        log(
          `Reclaimed a stale host-wide E2E lock from ${describeLockOwner(current.owner, Date.now())}; that process is no longer running.`,
        );
      }
      continue;
    }

    const waited = Date.now() - startedAt;
    const holder = describeLockOwner(current.owner, Date.now());
    if (waited >= maxWaitMs) {
      throw new Error(
        `[${label}] FAIL: timed out after ${formatDuration(maxWaitMs)} waiting for the host-wide E2E lock (${path}) held by ${holder}. Set RUNESPACE_E2E_LOCK_WAIT_MS to wait longer.`,
      );
    }
    if (current.raw !== reportedRaw) {
      log(
        `Waiting for the host-wide E2E lock held by ${holder}. Migrations, build, and tests start once it is released.`,
      );
      reportedRaw = current.raw;
      lastReportAt = Date.now();
    } else if (Date.now() - lastReportAt >= E2E_LOCK_PROGRESS_MS) {
      log(
        `Still waiting for the host-wide E2E lock (${formatDuration(waited)} so far), held by ${holder}.`,
      );
      lastReportAt = Date.now();
    }
    await sleep(Math.min(pollMs, maxWaitMs - waited), undefined, { signal }).catch(() => {
      throw signal.reason;
    });
  }
}

/**
 * Builds the small production-E2E process supervisor shared by the canonical
 * and focused runners. It owns exactly two kinds of children (the currently
 * active command and the production Next server), terminates only those, and
 * exposes label-scoped logging/failure so each runner keeps its own output
 * prefix. Phase sequencing, environment construction, and state preparation
 * remain the caller's responsibility.
 */
export function createE2eRuntime({ label, port, env, readyTimeoutMs }) {
  const log = (msg) => console.log(`[${label}] ${msg}`);
  const fail = (msg) => {
    throw new Error(`[${label}] FAIL: ${msg}`);
  };

  let activeProcess = null;
  let serverProcess = null;
  let cleanupPromise = null;
  let abortReason = null;
  const abortController = new AbortController();

  const throwIfAborted = () => {
    if (abortReason) fail(abortReason);
  };

  const abort = (reason) => {
    if (abortReason) return;
    abortReason = reason;
    abortController.abort(new Error(`[${label}] FAIL: ${reason}`));
  };

  function runCommand(args, commandLabel, command = PACKAGE_MANAGER) {
    throwIfAborted();
    return new Promise((resolveResult, rejectResult) => {
      const child = spawn(command, args, {
        cwd: ROOT,
        env,
        stdio: "inherit",
        detached: process.platform !== "win32",
      });
      activeProcess = child;
      let settled = false;

      const clearActive = () => {
        if (activeProcess === child) activeProcess = null;
      };
      const settle = (callback, value) => {
        if (settled) return;
        settled = true;
        clearActive();
        callback(value);
      };

      child.once("error", (error) => settle(rejectResult, error));
      child.once("close", (code, signal) => settle(resolveResult, { code, signal }));
    }).then(({ code, signal }) => {
      if (code !== 0 || signal) {
        fail(`${commandLabel} failed (${signal ? `signal ${signal}` : `exit ${code}`})`);
      }
      throwIfAborted();
    });
  }

  async function runTimedCommand(args, commandLabel, command = PACKAGE_MANAGER) {
    const startedAt = Date.now();
    log(`${commandLabel}...`);
    await runCommand(args, commandLabel, command);
    log(`${commandLabel} completed in ${Date.now() - startedAt} ms.`);
  }

  function startServer() {
    throwIfAborted();
    const child = spawn(PACKAGE_MANAGER, ["exec", "next", "start", "-p", String(port)], {
      cwd: ROOT,
      env,
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    serverProcess = child;
    child.once("error", (error) => {
      child.startupError = error;
    });
    log("Next production server started; waiting for /register readiness...");
  }

  async function waitForServer() {
    const baseURL = `http://127.0.0.1:${port}`;
    const deadline = Date.now() + readyTimeoutMs;
    let lastError = "no response";

    while (Date.now() < deadline) {
      throwIfAborted();
      if (serverProcess?.startupError) throw serverProcess.startupError;
      if (!isRunning(serverProcess)) fail("Next server exited before readiness");

      try {
        const response = await fetch(`${baseURL}/register`, {
          signal: AbortSignal.timeout(5_000),
        });
        if (response.status < 500) {
          log(`Next server ready at ${baseURL} (${response.status}).`);
          return;
        }
        lastError = `HTTP ${response.status}`;
      } catch (error) {
        lastError = error instanceof Error ? error.message : String(error);
      }
      await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
    }

    fail(`Next server did not become ready within ${readyTimeoutMs} ms (${lastError})`);
  }

  async function terminateOwned() {
    if (cleanupPromise) return cleanupPromise;
    cleanupPromise = (async () => {
      const phase = activeProcess;
      if (phase) await terminateProcess(phase, "active Playwright phase", log);
      const server = serverProcess;
      if (server) await terminateProcess(server, "Next server", log);
    })();
    return cleanupPromise;
  }

  return {
    log,
    fail,
    abort,
    signal: abortController.signal,
    throwIfAborted,
    runCommand,
    runTimedCommand,
    startServer,
    waitForServer,
    terminateOwned,
  };
}
