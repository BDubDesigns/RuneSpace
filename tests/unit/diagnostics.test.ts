import { describe, expect, it } from "vitest";
import { DIAGNOSTIC_MAX_BYTES, clientDiagnosticSchema } from "@/game/schemas/diagnostics";

const report = {
  timestamp: "2026-01-01T00:00:00.000Z",
  incidentId: "rs-abcdef1234567890",
  source: "mining-command",
  errorName: "Error",
  message: "Connection interrupted",
  route: "/play/[characterId]",
  online: true,
};

describe("client diagnostic contract", () => {
  it("accepts a redacted play route and configured release identifier", () => {
    expect(clientDiagnosticSchema.parse({ ...report, releaseId: "deploy-abc" }).releaseId).toBe(
      "deploy-abc",
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
