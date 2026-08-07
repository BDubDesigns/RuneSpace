import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl, validateLocalDatabaseUrl } from "@/scripts/local-db-url.mjs";

const SCRIPT_PATH = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../scripts/local-db-url.mjs",
);

/**
 * Unit coverage for the shared local-database URL safety boundary (Issue #74).
 * Proves accepted localhost-only postgres URLs, rejection of remote/malformed/
 * unsupported/`host`-query-override URLs, and that failure output never leaks
 * the URL, credentials, or query parameters.
 */

describe("validateLocalDatabaseUrl", () => {
  it("accepts a localhost postgresql URL", () => {
    expect(validateLocalDatabaseUrl("postgresql://user:secret@localhost:5432/runespace")).toEqual({
      ok: true,
      reason: null,
    });
  });

  it("accepts a 127.0.0.1 postgres URL", () => {
    expect(validateLocalDatabaseUrl("postgres://user:secret@127.0.0.1:5432/runespace")).toEqual({
      ok: true,
      reason: null,
    });
  });

  it("rejects an ordinary remote hostname", () => {
    const result = validateLocalDatabaseUrl("postgres://u:p@db.example.com:5432/runespace");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/must be localhost or 127\.0\.0\.1/);
  });

  it("rejects a malformed URL", () => {
    const result = validateLocalDatabaseUrl("not a url");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/not a valid URL/);
  });

  it("rejects a missing URL", () => {
    expect(validateLocalDatabaseUrl(undefined).ok).toBe(false);
    expect(validateLocalDatabaseUrl("").ok).toBe(false);
  });

  it("rejects an unsupported protocol", () => {
    const result = validateLocalDatabaseUrl("mysql://u:p@localhost:3306/runespace");
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/postgres or postgresql scheme/);
  });

  it("rejects a host query override on an otherwise-localhost URL", () => {
    const result = validateLocalDatabaseUrl(
      "postgresql://user:password@localhost/runespace?host=remote.example.com",
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/must not specify a host query parameter/);
  });

  it("rejects an encoded host query key that decodes to host", () => {
    const result = validateLocalDatabaseUrl(
      "postgresql://user:password@localhost/runespace?%68ost=remote.example.com",
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/must not specify a host query parameter/);
  });

  it("rejects a case-varied host query key", () => {
    const result = validateLocalDatabaseUrl(
      "postgresql://user:password@localhost/runespace?HoSt=remote.example.com",
    );
    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/must not specify a host query parameter/);
  });

  it("never includes the URL or credentials in a refusal reason", () => {
    const cases = [
      "postgres://user:supersecret@db.example.com:5432/runespace",
      "postgresql://user:supersecret@localhost/runespace?host=remote.example.com",
      "not a url",
    ];
    for (const url of cases) {
      const { reason } = validateLocalDatabaseUrl(url);
      expect(reason).not.toContain("supersecret");
      expect(reason).not.toContain("db.example.com");
      expect(reason).not.toContain("remote.example.com");
    }
  });
});

describe("assertLocalDatabaseUrl", () => {
  it("throws a generic message that hides credentials and the URL", () => {
    expect(() =>
      assertLocalDatabaseUrl(
        "postgresql://user:supersecret@localhost/runespace?host=remote.example.com",
      ),
    ).toThrow(/must not specify a host query parameter/);
    expect(() =>
      assertLocalDatabaseUrl("postgres://user:supersecret@db.example.com:5432/runespace"),
    ).toThrow(/must be localhost or 127\.0\.0\.1/);
  });
});

describe("local-db-url CLI invocation", () => {
  function runCli(databaseUrl: string) {
    return spawnSync(process.execPath, [SCRIPT_PATH], {
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl,
      },
    });
  }

  it("accepts a localhost URL and prints nothing", () => {
    const result = runCli("postgres://user:secret@127.0.0.1:5432/runespace");
    expect(result.status).toBe(0);
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });

  it("rejects a host query override with a generic message and no leaked data", () => {
    const result = runCli(
      "postgresql://user:supersecret@localhost/runespace?host=remote.example.com",
    );
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/must not specify a host query parameter/);
    expect(result.stderr).not.toContain("supersecret");
    expect(result.stderr).not.toContain("remote.example.com");
    expect(result.stderr).not.toContain("localhost/runespace");
  });

  it("rejects a remote hostname with a generic message and no leaked data", () => {
    const result = runCli("postgres://user:supersecret@db.example.com:5432/runespace");
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/must be localhost or 127\.0\.0\.1/);
    expect(result.stderr).not.toContain("supersecret");
    expect(result.stderr).not.toContain("db.example.com");
  });
});
