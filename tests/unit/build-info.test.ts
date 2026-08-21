import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/api/build-info/route";

const previousRelease = process.env.RUNESPACE_RELEASE_ID;

afterEach(() => {
  if (previousRelease === undefined) delete process.env.RUNESPACE_RELEASE_ID;
  else process.env.RUNESPACE_RELEASE_ID = previousRelease;
});

describe("GET /api/build-info", () => {
  it("returns the supplied exact release identity", async () => {
    const release = "0123456789abcdef0123456789abcdef01234567";
    process.env.RUNESPACE_RELEASE_ID = release;
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ releaseId: release });
  });

  it("returns explicit unknown when release metadata is missing", async () => {
    delete process.env.RUNESPACE_RELEASE_ID;
    const response = await GET();
    await expect(response.json()).resolves.toEqual({ releaseId: "unknown" });
  });

  it("sanitizes invalid/short release metadata instead of trusting it", async () => {
    // A value outside the established release contract is rejected, never echoed.
    process.env.RUNESPACE_RELEASE_ID = "not a real revision!";
    const response = await GET();
    await expect(response.json()).resolves.toEqual({ releaseId: "unknown" });
  });

  it("exposes only the releaseId field", async () => {
    process.env.RUNESPACE_RELEASE_ID = "abc-revision-def";
    const response = await GET();
    const body = await response.json();
    expect(Object.keys(body)).toEqual(["releaseId"]);
  });
});
