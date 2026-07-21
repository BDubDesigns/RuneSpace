import { beforeEach, describe, expect, it, vi } from "vitest";

const reportClientDiagnostic = vi.hoisted(() => vi.fn());

vi.mock("@/features/diagnostics/client", () => ({ reportClientDiagnostic }));

import {
  playBoundaryIncidentId,
  reportPlayBoundaryDiagnostic,
} from "@/app/play/[characterId]/error";

beforeEach(() => reportClientDiagnostic.mockClear());

describe("play error incident references", () => {
  it("keeps a valid digest visible and does not let accepted reporting replace it", () => {
    const error = Object.assign(new Error("render failed"), { digest: "next-safe-digest" });
    const setIncidentId = vi.fn();

    expect(playBoundaryIncidentId(error)).toBe("next-safe-digest");
    expect(reportPlayBoundaryDiagnostic(error, setIncidentId)).toBe("next-safe-digest");
    expect(reportClientDiagnostic).toHaveBeenCalledWith("play-boundary", error, {});
    expect(setIncidentId).not.toHaveBeenCalled();
  });

  it("shows a client id only after successful reporting when no digest exists", () => {
    const error = new Error("render failed");
    const setIncidentId = vi.fn();

    expect(playBoundaryIncidentId(error)).toBeUndefined();
    reportPlayBoundaryDiagnostic(error, setIncidentId);
    const options = reportClientDiagnostic.mock.calls[0]?.[2] as {
      onAccepted?: (incidentId: string) => void;
    };
    expect(setIncidentId).not.toHaveBeenCalled();
    options.onAccepted?.("rs-confirmed123456");
    expect(setIncidentId).toHaveBeenCalledWith("rs-confirmed123456");
  });

  it("leaves the recovery state without a false reference when reporting fails", () => {
    const setIncidentId = vi.fn();

    reportPlayBoundaryDiagnostic(new Error("render failed"), setIncidentId);

    expect(setIncidentId).not.toHaveBeenCalled();
  });
});
