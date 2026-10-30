import { afterEach, describe, expect, it, vi } from "vitest";

describe("optional Scapelikes configuration", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });
  it("leaves builds and preview runtime inert when credentials are absent or blank", async () => {
    vi.stubEnv("DATABASE_URL", "postgres://localhost/test");
    vi.stubEnv("SCAPELIKES_SITE_ID", " ");
    vi.stubEnv("SCAPELIKES_PRESENCE_CRON_SECRET", "");
    vi.resetModules();
    const { env } = await import("@/server/env");
    expect(env.SCAPELIKES_SITE_ID).toBeUndefined();
    expect(env.SCAPELIKES_PRESENCE_CRON_SECRET).toBeUndefined();
  });
});
