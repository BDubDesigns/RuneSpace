import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DIAGNOSTIC_MAX_BYTES,
  clientDiagnosticSchema,
  sanitizeClientDiagnostic,
} from "@/game/schemas/diagnostics";
import { installClientDiagnostics, reportClientDiagnostic } from "@/features/diagnostics/client";
import { logClientDiagnostic, logDiagnostic } from "@/server/diagnostics";

const report = {
  timestamp: "2026-01-01T00:00:00.000Z",
  incidentId: "rs-abcdef1234567890",
  source: "mining-command" as const,
  errorName: "Error",
  message: "Connection interrupted",
  route: "/play/[characterId]" as const,
  online: true,
};

const originalWindow = globalThis.window;
const originalNavigator = globalThis.navigator;
const originalFetch = globalThis.fetch;

afterEach(() => {
  Object.defineProperty(globalThis, "window", { configurable: true, value: originalWindow });
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: originalNavigator });
  Object.defineProperty(globalThis, "fetch", { configurable: true, value: originalFetch });
});

describe("client diagnostic contract", () => {
  it("accepts a redacted play route and browser release identifier", () => {
    expect(
      clientDiagnosticSchema.parse({ ...report, clientReleaseId: "browser-deploy-abc" })
        .clientReleaseId,
    ).toBe("browser-deploy-abc");
  });

  it("retains a commit-shaped release id separately from diagnostic text", () => {
    const release = "0123456789abcdef0123456789abcdef01234567";
    expect(sanitizeClientDiagnostic({ ...report, clientReleaseId: release }).clientReleaseId).toBe(
      release,
    );
  });

  it("rejects unknown sensitive fields and raw dynamic routes", () => {
    expect(clientDiagnosticSchema.safeParse({ ...report, cookie: "secret" }).success).toBe(false);
    expect(
      clientDiagnosticSchema.safeParse({ ...report, route: "/play/real-character-id" }).success,
    ).toBe(false);
  });

  it("bounds report payload fields", () => {
    expect(
      clientDiagnosticSchema.safeParse({ ...report, message: "x".repeat(DIAGNOSTIC_MAX_BYTES) })
        .success,
    ).toBe(false);
  });
});

describe("diagnostic safety", () => {
  it("removes sensitive message and stack values before the serialized server log", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sensitive =
      "pilot@example.com https://example.test/play/abc?token=secret Bearer top-secret-token 123e4567-e89b-12d3-a456-426614174000";
    const previousRelease = process.env.RUNESPACE_RELEASE_ID;
    process.env.RUNESPACE_RELEASE_ID = "server-release";

    logClientDiagnostic({
      ...report,
      clientReleaseId: "browser-release",
      message: sensitive,
      stack: `Error: ${sensitive}\n    at webpack://private/module.ts:1:1`,
    });

    const line = String(logged.mock.calls[0]?.[0]);
    expect(line).not.toContain("pilot@example.com");
    expect(line).not.toContain("example.test");
    expect(line).not.toContain("top-secret-token");
    expect(line).not.toContain("123e4567-e89b-12d3-a456-426614174000");
    expect(line).not.toContain("webpack:");
    expect(line).toContain('"clientReleaseId":"browser-release"');
    expect(line).toContain('"serverReleaseId":"server-release"');
    process.env.RUNESPACE_RELEASE_ID = previousRelease;
  });

  it("removes credentials, state, and identifiers from final browser and server logs", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const cases = [
      { text: "Authorization: Basic dXNlcjpwYXNz", privateValues: ["dXNlcjpwYXNz"] },
      { text: "Proxy-Authorization: Bearer proxy-private", privateValues: ["proxy-private"] },
      { text: "cookie: session=abc; auth=def", privateValues: ["session=abc", "auth=def"] },
      { text: "Set-Cookie: session=another-private; HttpOnly", privateValues: ["another-private"] },
      { text: "token=supersecret", privateValues: ["supersecret"] },
      { text: "password is hunter2", privateValues: ["hunter2"] },
      { text: "password => arrow-private", privateValues: ["arrow-private"] },
      {
        text: "credential: credential-private auth=auth-private session id: session-private api key=key-private secret is secret-private",
        privateValues: [
          "credential-private",
          "auth-private",
          "session-private",
          "key-private",
          "secret-private",
        ],
      },
      {
        text: 'state={"inventory":[{"itemId":"ore","quantity":999}]}',
        privateValues: ['"inventory"'],
      },
      { text: "characterId=character-private-42", privateValues: ["character-private-42"] },
      {
        text: "database=postgres://db-user:db-private@db.internal/runespace",
        privateValues: ["db-private", "db.internal"],
      },
      { text: "Cookie: session=abc\n folded-private", privateValues: ["folded-private"] },
    ];

    for (const [index, diagnosticCase] of cases.entries()) {
      logClientDiagnostic({
        ...report,
        incidentId: `rs-browsercase${index}`,
        message: diagnosticCase.text,
        stack: diagnosticCase.text,
      });
      logDiagnostic(
        "server",
        { category: "render-failure", route: "/play/[characterId]" },
        new Error(diagnosticCase.text),
      );
    }

    for (const [index, diagnosticCase] of cases.entries()) {
      const browserLine = String(logged.mock.calls[index * 2]?.[0]);
      const serverLine = String(logged.mock.calls[index * 2 + 1]?.[0]);
      for (const line of [browserLine, serverLine]) {
        for (const privateValue of diagnosticCase.privateValues)
          expect(line).not.toContain(privateValue);
      }
      expect(browserLine).toContain('"route":"/play/[characterId]"');
      expect(browserLine).toContain('"source":"mining-command"');
      expect(serverLine).toContain('"route":"/play/[characterId]"');
      expect(serverLine).toContain('"category":"render-failure"');
    }
    expect(logged).toHaveBeenCalledTimes(cases.length * 2);
  });

  it("never lets reporter failures escape and retains one incident id per Error", () => {
    const sendBeacon = vi.fn(() => {
      throw new Error("beacon unavailable");
    });
    Object.defineProperty(globalThis, "navigator", {
      configurable: true,
      value: { onLine: true, sendBeacon, userAgent: "test" },
    });
    Object.defineProperty(globalThis, "fetch", {
      configurable: true,
      value: vi.fn(() => Promise.reject(new Error("network unavailable"))),
    });
    const error = new Error("Bearer private-token");

    expect(() => reportClientDiagnostic("mining-command", error)).not.toThrow();
    expect(reportClientDiagnostic("window-error", error)).toBe(
      reportClientDiagnostic("unhandled-rejection", error),
    );
  });

  it("installs each global listener once", () => {
    const addEventListener = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: { addEventListener },
    });

    installClientDiagnostics();
    installClientDiagnostics();

    expect(addEventListener).toHaveBeenCalledTimes(2);
    expect(addEventListener.mock.calls.map(([event]) => event)).toEqual([
      "error",
      "unhandledrejection",
    ]);
  });
});
