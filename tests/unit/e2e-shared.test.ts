import { createServer, type Server } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  assertLocalDatabaseUrl,
  assertNode22,
  assertPortAvailable,
  readPositiveDuration,
  readPositiveInteger,
} from "@/scripts/e2e-shared.mjs";
import {
  DEFAULT_FOCUSED_PORT,
  FOCUSED_AUTH_SECRET,
  buildFocusedEnv,
  requireFocusedSpec,
  resolveFocusedPort,
} from "@/scripts/run-focused-e2e.mjs";

describe("readPositiveInteger / readPositiveDuration", () => {
  it("falls back to the default when no value is supplied", () => {
    expect(readPositiveInteger(undefined, 120, "Ready")).toBe(120);
    expect(readPositiveInteger("", 120, "Ready")).toBe(120);
    expect(readPositiveDuration(undefined, 900)).toBe(900);
  });

  it("parses a positive integer value", () => {
    expect(readPositiveInteger("42", 120, "Ready")).toBe(42);
    expect(readPositiveDuration("30", 900)).toBe(30);
  });

  it("rejects zero, negative, non-numeric, fractional, and trailing-junk values", () => {
    expect(() => readPositiveInteger("0", 120, "Ready")).toThrow(/positive integer/);
    expect(() => readPositiveInteger("-1", 120, "Ready")).toThrow(/positive integer/);
    expect(() => readPositiveInteger("abc", 120, "Ready")).toThrow(/positive integer/);
    expect(() => readPositiveDuration("abc12", 900)).toThrow(/positive integer/);
    expect(() => readPositiveInteger("12.5", 120, "Ready")).toThrow(/positive integer/);
    expect(() => readPositiveDuration("1025junk", 900)).toThrow(/positive integer/);
  });
});

describe("requireFocusedSpec", () => {
  it("accepts the mining phase", () => {
    expect(requireFocusedSpec(["mining"])).toBe("mining");
  });

  it("rejects an omitted, extra, flag, or unknown phase argument", () => {
    expect(() => requireFocusedSpec([])).toThrow(/exactly one phase/);
    expect(() => requireFocusedSpec(["mining", "overlay"])).toThrow(/exactly one phase/);
    expect(() => requireFocusedSpec(["--project=chromium"])).toThrow(/unsupported focused phase/);
    expect(() => requireFocusedSpec(["overlay"])).toThrow(/unsupported focused phase/);
    expect(() => requireFocusedSpec(["../mining"])).toThrow(/unsupported focused phase/);
  });
});

describe("resolveFocusedPort", () => {
  it("defaults to the documented focused high port", () => {
    expect(resolveFocusedPort(undefined)).toBe(DEFAULT_FOCUSED_PORT);
    expect(DEFAULT_FOCUSED_PORT).not.toBe(3000);
    expect(DEFAULT_FOCUSED_PORT).not.toBe(3200);
  });

  it("accepts an explicit validated high-port override", () => {
    expect(resolveFocusedPort("4100")).toBe(4100);
  });

  it("rejects OpenChamber's port 3000 and the canonical runner's port 3200", () => {
    expect(() => resolveFocusedPort("3000")).toThrow(/3000 belongs to OpenChamber/);
    expect(() => resolveFocusedPort("3200")).toThrow(/3200 to the canonical runner/);
  });

  it("rejects low, out-of-range, non-integer, fractional, and junk ports", () => {
    expect(() => resolveFocusedPort("80")).toThrow(/high port in 1024\.\.65535/);
    expect(() => resolveFocusedPort("70000")).toThrow(/high port in 1024\.\.65535/);
    expect(() => resolveFocusedPort("abc")).toThrow(/positive integer/);
    expect(() => resolveFocusedPort("1024.5")).toThrow(/positive integer/);
    expect(() => resolveFocusedPort("1025junk")).toThrow(/positive integer/);
  });
});

describe("buildFocusedEnv", () => {
  it("constructs the phase environment on a localhost database", () => {
    const env = buildFocusedEnv({
      databaseUrl: "postgres://runespace:runespace@127.0.0.1:5432/runespace",
      port: 3310,
    });
    expect(env.CI).toBe("true");
    expect(env.DATABASE_URL).toBe("postgres://runespace:runespace@127.0.0.1:5432/runespace");
    expect(env.BETTER_AUTH_SECRET).toBe(FOCUSED_AUTH_SECRET);
    expect(env.BETTER_AUTH_SECRET!.length).toBeGreaterThanOrEqual(16);
    expect(env.RUNESPACE_E2E_CANONICAL_HTTP).toBe("true");
    expect(env.RUNESPACE_E2E_EXTERNAL_SERVER).toBe("true");
    expect(env.RUNESPACE_E2E_MINING).toBe("true");
    expect(env.RUNESPACE_E2E_PLAY_ERROR).toBe("true");
    expect(env.RUNESPACE_E2E_TRAVEL).toBeUndefined();
    expect(env.PLAYWRIGHT_PORT).toBe("3310");
    expect(env.PORT).toBe("3310");
    expect(env.BASE_URL).toBe("http://127.0.0.1:3310");
  });

  it("refuses to build an environment for a remote database", () => {
    expect(() =>
      buildFocusedEnv({ databaseUrl: "postgres://u:p@db.example.com:5432/runespace", port: 3310 }),
    ).toThrow(/must be localhost or 127\.0\.0\.1/);
  });
});

describe("assertLocalDatabaseUrl", () => {
  it("accepts localhost and 127.0.0.1 hosts", () => {
    expect(() => assertLocalDatabaseUrl("postgres://u:p@localhost:5432/runespace")).not.toThrow();
    expect(() => assertLocalDatabaseUrl("postgres://u:p@127.0.0.1:5432/runespace")).not.toThrow();
  });

  it("rejects missing, malformed, and remote URLs", () => {
    expect(() => assertLocalDatabaseUrl(undefined)).toThrow(/DATABASE_URL is required/);
    expect(() => assertLocalDatabaseUrl("not a url")).toThrow(/not a valid URL/);
    expect(() => assertLocalDatabaseUrl("postgres://u:p@db.example.com:5432/db")).toThrow(
      /must be localhost or 127\.0\.0\.1/,
    );
  });
});

describe("assertNode22", () => {
  it("accepts a Node 22.x version", () => {
    expect(() => assertNode22("22.22.2")).not.toThrow();
  });

  it("rejects other major versions", () => {
    expect(() => assertNode22("24.18.1")).toThrow(/Node 22\.x required/);
    expect(() => assertNode22("21.0.0")).toThrow(/Node 22\.x required/);
  });
});

describe("assertPortAvailable", () => {
  let listener: Server | undefined;
  let occupiedPort = 0;

  beforeAll(async () => {
    listener = createServer();
    await new Promise<void>((resolveListen) => {
      listener!.listen(0, "127.0.0.1", () => {
        occupiedPort = (listener!.address() as { port: number }).port;
        resolveListen();
      });
    });
  });

  afterAll(async () => {
    await new Promise<void>((resolveClose) => listener!.close(() => resolveClose()));
  });

  it("rejects a port that already has a listener", async () => {
    await expect(assertPortAvailable(occupiedPort)).rejects.toThrow(/already in use/);
  });

  it("resolves for a confirmed-free high port", async () => {
    const probe = createServer();
    await new Promise<void>((resolveListen) => probe.listen(0, "127.0.0.1", () => resolveListen()));
    const freePort = (probe.address() as { port: number }).port;
    await new Promise<void>((resolveClose) => probe.close(() => resolveClose()));
    await expect(assertPortAvailable(freePort)).resolves.toBeUndefined();
  });
});
