import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  count: vi.fn(),
  env: {
    SCAPELIKES_PRESENCE_CRON_SECRET: undefined as string | undefined,
    SCAPELIKES_SITE_ID: undefined as string | undefined,
  },
}));
vi.mock("@/server/env", () => ({ env: mocks.env }));
vi.mock("@/server/player-presence", () => ({ getPlayersOnline: mocks.count }));
import { POST } from "@/app/api/integrations/scapelikes-presence/route";

const secret = "test-secret-012345678901234567890123456789";
const siteId = "private-site-id";
const url = "http://localhost/api/integrations/scapelikes-presence";
const request = (query = "", authorization = `Bearer ${secret}`) =>
  new Request(url + query, {
    method: "POST",
    headers: { authorization },
    body: JSON.stringify({ online: 999 }),
  });

describe("Scapelikes presence route", () => {
  let send: ReturnType<typeof vi.fn>;
  let logs: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    mocks.env.SCAPELIKES_PRESENCE_CRON_SECRET = secret;
    mocks.env.SCAPELIKES_SITE_ID = siteId;
    mocks.count.mockReset().mockResolvedValue(0);
    send = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", send);
    logs = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("refuses missing, wrong, or weak secrets before count or network", async () => {
    expect((await POST(request("", ""))).status).toBe(401);
    expect((await POST(request("", "Bearer incorrect"))).status).toBe(401);
    mocks.env.SCAPELIKES_PRESENCE_CRON_SECRET = undefined;
    expect((await POST(request())).status).toBe(401);
    mocks.env.SCAPELIKES_PRESENCE_CRON_SECRET = "short";
    expect((await POST(request("", "Bearer short"))).status).toBe(401);
    expect(mocks.count).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it.each([0, 17])("sends the authoritative count %i in exactly one POST", async (count) => {
    mocks.count.mockResolvedValue(count);
    const response = await POST(request());
    expect(response.status).toBe(204);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(send).toHaveBeenCalledOnce();
    const [target, options] = send.mock.calls[0]!;
    expect(String(target)).toBe(`https://api.scapelikes.com/v1/presence/aggregate/${siteId}`);
    expect(options.method).toBe("POST");
    expect(options.headers).toEqual({ "content-type": "application/json" });
    expect(options.body).toBe(JSON.stringify({ online: count }));
    expect(options.redirect).toBe("error");
    expect(options.signal).toBeInstanceOf(AbortSignal);
  });

  it("sends a provider dry-run and rejects malformed modes rather than writing live", async () => {
    expect((await POST(request("?dry_run=1"))).status).toBe(204);
    expect(String(send.mock.calls[0]![0])).toBe(
      `https://api.scapelikes.com/v1/presence/aggregate/${siteId}?dry_run=1`,
    );
    send.mockClear();
    mocks.count.mockClear();
    for (const query of ["?dry_run=0", "?dry_run=", "?dry_run=1&dry_run=1", "?dry-run=1"]) {
      expect((await POST(request(query))).status).toBe(400);
    }
    expect(send).not.toHaveBeenCalled();
    expect(mocks.count).not.toHaveBeenCalled();
  });

  it("fails safely with missing provider config before reading presence", async () => {
    mocks.env.SCAPELIKES_SITE_ID = undefined;
    expect((await POST(request())).status).toBe(503);
    expect(mocks.count).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("rejects invalid counts without an outbound call", async () => {
    for (const value of [-1, 1.5, NaN]) {
      mocks.count.mockResolvedValue(value);
      expect((await POST(request())).status).toBe(502);
    }
    expect(send).not.toHaveBeenCalled();
  });

  it("handles a provider rejection or connection error without leaking details or retrying", async () => {
    for (const failure of [
      new Response("private response", { status: 429 }),
      new Error(`failed ${siteId} ${secret}`),
    ]) {
      send.mockReset();
      if (failure instanceof Error) send.mockRejectedValue(failure);
      else send.mockResolvedValue(failure);
      const response = await POST(request());
      expect(response.status).toBe(502);
      expect(await response.text()).not.toContain(siteId);
      expect(send).toHaveBeenCalledOnce();
    }
    expect(JSON.stringify(logs.mock.calls)).not.toContain(siteId);
    expect(JSON.stringify(logs.mock.calls)).not.toContain(secret);
    expect(JSON.stringify(logs.mock.calls)).not.toContain("private response");
  });

  it("surfaces a count failure without a provider request or leaking the error", async () => {
    mocks.count.mockRejectedValue(new Error(`database ${secret}`));
    const response = await POST(request());
    expect(response.status).toBe(502);
    expect(send).not.toHaveBeenCalled();
    expect(JSON.stringify(logs.mock.calls)).not.toContain(secret);
  });

  it("sets a five-second abort deadline and surfaces a timeout", async () => {
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(controller.signal);
    send.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) =>
          init.signal.addEventListener("abort", () => reject(new Error(siteId))),
        ),
    );
    const pending = POST(request());
    await vi.waitFor(() => expect(send).toHaveBeenCalledOnce());
    expect(timeout).toHaveBeenCalledWith(5_000);
    controller.abort();
    expect((await pending).status).toBe(502);
    expect(send).toHaveBeenCalledOnce();
    expect(JSON.stringify(logs.mock.calls)).not.toContain(siteId);
  });
});

describe("Coolify task", () => {
  it("uses localhost and the configured port, preserves dry-run and fails on non-2xx", async () => {
    const seen: { url?: string; auth?: string }[] = [];
    let status = 204;
    const server = createServer((req, res) => {
      seen.push({ url: req.url, auth: req.headers.authorization });
      res.writeHead(status).end();
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("No test port");
    const run = async (env: Partial<NodeJS.ProcessEnv>, ...args: string[]) => {
      const child = spawn(process.execPath, ["server/scapelikes-presence-task.mjs", ...args], {
        env: {
          ...process.env,
          PORT: String(address.port),
          SCAPELIKES_PRESENCE_CRON_SECRET: secret,
          ...env,
        },
      });
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        output += chunk;
      });
      const [code] = await once(child, "close");
      expect(output).not.toContain(secret);
      return code;
    };
    try {
      expect(await run({}, "--dry-run")).toBe(0);
      expect(await run({})).toBe(0);
      status = 503;
      expect(await run({})).toBe(1);
      expect(await run({}, "--dryrun")).toBe(1);
      expect(await run({ SCAPELIKES_PRESENCE_CRON_SECRET: "" })).toBe(1);
      expect(await run({ PORT: "not-a-port" })).toBe(1);
      expect(await run({ PORT: "1" })).toBe(1);
      expect(seen).toEqual([
        { url: "/api/integrations/scapelikes-presence?dry_run=1", auth: `Bearer ${secret}` },
        { url: "/api/integrations/scapelikes-presence", auth: `Bearer ${secret}` },
        { url: "/api/integrations/scapelikes-presence", auth: `Bearer ${secret}` },
      ]);
    } finally {
      server.close();
    }
  });
});
