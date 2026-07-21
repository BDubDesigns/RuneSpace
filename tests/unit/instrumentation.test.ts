import { describe, expect, it, vi } from "vitest";

const diagnostics = vi.hoisted(() => ({ logDiagnostic: vi.fn() }));

vi.mock("@/server/diagnostics", () => diagnostics);

import { onRequestError, safeRoute } from "@/instrumentation";

describe("safeRoute", () => {
  it("recognizes only the Next app route-file play forms", () => {
    expect(safeRoute("/app/play/[characterId]")).toBe("/play/[characterId]");
    expect(safeRoute("/play/[characterId]")).toBe("/play/[characterId]");
    expect(safeRoute("/app/play/[characterId]/page")).toBe("/play/[characterId]");
    expect(safeRoute("/play/[characterId]/page")).toBe("/play/[characterId]");
    const suppliedDynamicValue = safeRoute("/app/play/private-character-id");
    expect(suppliedDynamicValue).toBe("/other");
    expect(suppliedDynamicValue).not.toContain("private-character-id");
    expect(safeRoute("/app/play/[otherId]")).toBe("/other");
    expect(safeRoute("/app/play/[characterId]/layout")).toBe("/other");
    expect(safeRoute("/app/characters/[characterId]")).toBe("/other");
  });
});

describe("onRequestError", () => {
  it.each([
    ["action", "server-action-failure"],
    ["render", "render-failure"],
    ["route", "request-failure"],
  ] as const)("keeps %s failures in the %s category", (routeType, category) => {
    onRequestError(
      new Error("failed"),
      { method: "GET" } as never,
      {
        routePath: "/app/play/[characterId]",
        routeType,
        routerKind: "AppRouter",
      } as never,
    );

    expect(diagnostics.logDiagnostic).toHaveBeenLastCalledWith(
      "server",
      expect.objectContaining({ category, route: "/play/[characterId]" }),
      expect.any(Error),
    );
  });
});
