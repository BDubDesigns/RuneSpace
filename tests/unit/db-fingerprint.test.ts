import { describe, expect, it } from "vitest";
import { classifyDatabaseUrl, projectFingerprint } from "@/scripts/db-fingerprint.mjs";

const SECRETS = [
  "hunter2",
  "super-secret-password",
  "postgres://runespace:pw@localhost:5432/runespace",
  "sslmode=require",
];

function includesAnySecret(text: string) {
  return SECRETS.some((secret) => text.includes(secret));
}

describe("db fingerprint projection", () => {
  it("reports only approved non-secret identity fields", () => {
    const projection = projectFingerprint(
      {
        database: "runespace_issue_75",
        dbUser: "runespace_dev",
        serverPort: 5432,
        inRecovery: false,
      },
      "tcp",
    );
    expect(projection).toEqual({
      database: "runespace_issue_75",
      user: "runespace_dev",
      serverPort: 5432,
      socket: "tcp",
      inRecovery: false,
    });
  });

  it("never includes a password, full URL, or query string", () => {
    const projection = projectFingerprint(
      {
        database: process.env.DATABASE_URL ?? "secret-db",
        dbUser: "user",
        serverPort: 5432,
        inRecovery: false,
      },
      "unix",
    );
    expect(includesAnySecret(JSON.stringify(projection))).toBe(false);
    expect(projection.socket).toBe("unix");
  });
});

describe("build-info / fingerprint safety", () => {
  it("classifies a missing URL as failing safely", () => {
    const result = classifyDatabaseUrl(undefined);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not set");
  });

  it("classifies an empty URL as failing safely", () => {
    expect(classifyDatabaseUrl("").ok).toBe(false);
  });

  it("classifies a malformed URL as failing safely", () => {
    const result = classifyDatabaseUrl("not a url at all");
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("not a valid URL");
  });

  it("does not leak secrets in a safe failure message", () => {
    const result = classifyDatabaseUrl(
      "postgres://runespace:hunter2@localhost:5432/runespace?sslmode=require",
    );
    expect(result.ok).toBe(true);
    expect(includesAnySecret(JSON.stringify(result))).toBe(false);
  });

  it("leaves a well-formed URL classified as usable without echoing credentials", () => {
    const result = classifyDatabaseUrl("postgres://runespace:pw@localhost:5432/runespace");
    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
    expect(JSON.stringify(result)).not.toContain("pw");
  });
});
