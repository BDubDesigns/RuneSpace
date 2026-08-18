import type { SpawnSyncOptions, SpawnSyncReturns } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import {
  buildTargetDatabaseUrl,
  createDatabase,
  dropDatabase,
  LocalDatabaseError,
  normalizeDatabaseKey,
  parseControlDatabaseUrl,
  runDatabaseCommand,
  safeErrorMessage,
} from "@/scripts/runespace-db.mjs";

const CONTROL_URL = "postgresql://runespace_dev:local-test-secret@127.0.0.1:5432/runespace_control";

function createFakeClientFactory(rowCounts: number[]) {
  const queries: Array<{ parameters?: unknown[]; sql: string }> = [];
  const connectionStrings: string[] = [];
  const connect = vi.fn(async () => undefined);
  const end = vi.fn(async () => undefined);
  const query = vi.fn(async (sql: string, parameters?: unknown[]) => {
    queries.push({ parameters, sql });
    return { rowCount: rowCounts.shift() ?? 0 };
  });
  const clientFactory = (connectionString: string) => {
    connectionStrings.push(connectionString);
    return { connect, end, query };
  };

  return { clientFactory, connectionStrings, connect, end, queries, query };
}

describe("normalizeDatabaseKey", () => {
  it.each([
    ["issue-84", "runespace_issue_84"],
    ["issue-1", "runespace_issue_1"],
    ["scratch", "runespace_scratch"],
    ["scratch-isolation", "runespace_scratch_isolation"],
    ["scratch-issue-84", "runespace_scratch_issue_84"],
  ])("normalizes %s to %s", (key, expected) => {
    expect(normalizeDatabaseKey(key)).toBe(expected);
  });

  it.each([
    "issue-0",
    "issue-01",
    "issue--84",
    "Issue-84",
    "scratch-",
    "scratch-two_words",
    "scratch-unsafe;drop-database",
    "runespace_control",
    "production",
  ])("rejects unsafe or unsupported key %s", (key) => {
    expect(() => normalizeDatabaseKey(key)).toThrow(LocalDatabaseError);
  });

  it("rejects a normalized identifier longer than PostgreSQL's limit", () => {
    expect(() => normalizeDatabaseKey(`scratch-${"a".repeat(60)}`)).toThrow(
      /issue-<number> or scratch/,
    );
    expect(() => normalizeDatabaseKey(`issue-${"1".repeat(60)}`)).toThrow(
      /issue-<number> or scratch/,
    );
  });
});

describe("control and target URLs", () => {
  it("requires the localhost control database and dedicated role", () => {
    expect(parseControlDatabaseUrl(CONTROL_URL).pathname).toBe("/runespace_control");
    expect(() =>
      parseControlDatabaseUrl(
        "postgresql://runespace_dev:secret@db.example.com:5432/runespace_control",
      ),
    ).toThrow(/localhost or 127\.0\.0\.1/);
    expect(() =>
      parseControlDatabaseUrl(
        "postgresql://runespace_dev:secret@127.0.0.1:5432/runespace_issue_84",
      ),
    ).toThrow(/must select runespace_control/);
    expect(() =>
      parseControlDatabaseUrl("postgresql://postgres:secret@127.0.0.1:5432/runespace_control"),
    ).toThrow(/must authenticate as runespace_dev/);
  });

  it.each(["user=postgres", "password=override", "port=6543", "database=postgres"])(
    "rejects a connection-setting query override: %s",
    (query) => {
      expect(() => parseControlDatabaseUrl(`${CONTROL_URL}?${query}`)).toThrow(
        /must not contain query parameters/,
      );
    },
  );

  it("preserves credentials without printing them and selects the normalized target", () => {
    const result = buildTargetDatabaseUrl(CONTROL_URL, "scratch-isolation");
    expect(result.databaseName).toBe("runespace_scratch_isolation");
    expect(new URL(result.databaseUrl).pathname).toBe("/runespace_scratch_isolation");
    expect(new URL(result.databaseUrl).password).toBe("local-test-secret");
  });
});

describe("database lifecycle", () => {
  it("creates only a missing normalized disposable database", async () => {
    const fake = createFakeClientFactory([0, 0]);
    await expect(
      createDatabase(CONTROL_URL, "issue-84", { clientFactory: fake.clientFactory }),
    ).resolves.toBe("runespace_issue_84");

    expect(fake.connectionStrings).toEqual([CONTROL_URL]);
    expect(fake.queries).toEqual([
      {
        sql: "SELECT 1 FROM pg_database WHERE datname = $1",
        parameters: ["runespace_issue_84"],
      },
      { sql: 'CREATE DATABASE "runespace_issue_84"', parameters: undefined },
    ]);
    expect(fake.connect).toHaveBeenCalledOnce();
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it("refuses to create over an existing database", async () => {
    const fake = createFakeClientFactory([1]);
    await expect(
      createDatabase(CONTROL_URL, "issue-84", { clientFactory: fake.clientFactory }),
    ).rejects.toThrow(/already exists/);
    expect(fake.queries).toHaveLength(1);
    expect(fake.end).toHaveBeenCalledOnce();
  });

  it("force-drops only an existing normalized disposable database", async () => {
    const fake = createFakeClientFactory([1, 0]);
    await expect(
      dropDatabase(CONTROL_URL, "scratch-isolation", { clientFactory: fake.clientFactory }),
    ).resolves.toBe("runespace_scratch_isolation");
    expect(fake.queries[1]).toEqual({
      sql: 'DROP DATABASE "runespace_scratch_isolation" WITH (FORCE)',
      parameters: undefined,
    });
  });

  it("refuses to drop a missing database", async () => {
    const fake = createFakeClientFactory([0]);
    await expect(
      dropDatabase(CONTROL_URL, "issue-84", { clientFactory: fake.clientFactory }),
    ).rejects.toThrow(/does not exist/);
    expect(fake.queries).toHaveLength(1);
  });
});

describe("runDatabaseCommand", () => {
  it("probes the selected database and spawns an argument vector without a shell", async () => {
    const fake = createFakeClientFactory([1]);
    const spawnSyncImpl = vi.fn(
      (_command: string, _args: string[], _options: SpawnSyncOptions) =>
        ({ signal: null, status: 17 }) as SpawnSyncReturns<Buffer>,
    );

    await expect(
      runDatabaseCommand(CONTROL_URL, "issue-84", ["pnpm", "test:integration"], {
        clientFactory: fake.clientFactory,
        spawnSyncImpl,
      }),
    ).resolves.toEqual({ signal: null, status: 17 });

    expect(new URL(fake.connectionStrings[0]!).pathname).toBe("/runespace_issue_84");
    expect(spawnSyncImpl).toHaveBeenCalledOnce();
    const [command, args, options] = spawnSyncImpl.mock.calls[0]!;
    expect(command).toBe("pnpm");
    expect(args).toEqual(["test:integration"]);
    expect(options.shell).toBe(false);
    expect(new URL(options.env!.DATABASE_URL!).pathname).toBe("/runespace_issue_84");
  });

  it("requires a command", async () => {
    await expect(runDatabaseCommand(CONTROL_URL, "issue-84", [])).rejects.toThrow(
      /requires a command/,
    );
  });
});

describe("safeErrorMessage", () => {
  it("preserves known safe errors and redacts raw driver failures", () => {
    expect(safeErrorMessage(new LocalDatabaseError("disposable database already exists"))).toBe(
      "disposable database already exists",
    );
    const raw = "connection failed for postgresql://user:supersecret@db.example.com/database";
    const message = safeErrorMessage(new Error(raw));
    expect(message).toBe("database operation failed");
    expect(message).not.toContain("supersecret");
    expect(message).not.toContain("db.example.com");
  });
});
