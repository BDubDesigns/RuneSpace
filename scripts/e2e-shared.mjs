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

import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const PACKAGE_MANAGER = process.platform === "win32" ? "pnpm.cmd" : "pnpm";

// The local-database safety rule lives in one authoritative place
// (scripts/local-db-url.mjs) and is re-exported here so the canonical and
// focused runners keep their existing import surface while always using the
// strengthened validator.
export { assertLocalDatabaseUrl } from "./local-db-url.mjs";

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

  const throwIfAborted = () => {
    if (abortReason) fail(abortReason);
  };

  const abort = (reason) => {
    if (!abortReason) abortReason = reason;
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
    throwIfAborted,
    runCommand,
    runTimedCommand,
    startServer,
    waitForServer,
    terminateOwned,
  };
}
