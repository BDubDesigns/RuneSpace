import { describe, expect, it, vi } from "vitest";

const diagnostics = vi.hoisted(() => ({ logClientDiagnostic: vi.fn() }));

vi.mock("@/server/diagnostics", () => diagnostics);

import { POST } from "@/app/api/diagnostics/route";

const report = JSON.stringify({
  timestamp: "2026-01-01T00:00:00.000Z",
  incidentId: "rs-abcdef1234567890",
  source: "mining-command",
  errorName: "Error",
  message: "Connection interrupted",
  route: "/play/[characterId]",
  online: true,
});

function request(body = report, headers: HeadersInit = { "content-type": "application/json" }) {
  return new Request("http://runespace.test/api/diagnostics", { method: "POST", headers, body });
}

describe("POST /api/diagnostics", () => {
  it("accepts a safe diagnostic", async () => {
    expect((await POST(request())).status).toBe(204);
    expect(diagnostics.logClientDiagnostic).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed, cross-origin, and wrong-content requests without logging", async () => {
    expect((await POST(request("{nope"))).status).toBe(400);
    expect((await POST(request(report, { "content-type": "text/plain" }))).status).toBe(415);
    expect(
      (
        await POST(
          request(report, {
            "content-type": "application/json",
            origin: "https://attacker.test",
          }),
        )
      ).status,
    ).toBe(415);
    expect(diagnostics.logClientDiagnostic).toHaveBeenCalledTimes(1);
  });

  it("rejects declared and streamed oversized bodies without logging", async () => {
    expect(
      (
        await POST(
          request(report, {
            "content-type": "application/json",
            "content-length": "9000",
          }),
        )
      ).status,
    ).toBe(413);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(9_000)));
        controller.close();
      },
    });
    const streamed = new Request("http://runespace.test/api/diagnostics", {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1" },
      body: stream,
      duplex: "half",
    } as RequestInit & { duplex: "half" });
    expect((await POST(streamed)).status).toBe(413);
    expect(diagnostics.logClientDiagnostic).toHaveBeenCalledTimes(1);
  });

  it("rate limits only accepted reports and returns Retry-After", async () => {
    for (let index = 0; index < 29; index += 1) expect((await POST(request())).status).toBe(204);
    const response = await POST(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("60");
    expect(diagnostics.logClientDiagnostic).toHaveBeenCalledTimes(30);
  });
});
