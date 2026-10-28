import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { BetterAuthOptions } from "better-auth";

/**
 * Trusted client-address resolution for the offline country classifier
 * (issue #419). It must agree with the account abuse limiter, which resolves
 * the same address through Better Auth's `getIp` and the shared `authOptions`,
 * and it must not be able to use any other IP configuration.
 *
 * `authOptions` parses the server environment on import, so the same throwaway
 * values other server unit tests use are stubbed first.
 */

vi.stubEnv("DATABASE_URL", "postgres://test:test@localhost:5432/test");
vi.stubEnv("BETTER_AUTH_SECRET", "unit-test-secret-0123456789");

const { isPublicClientIp, resolveClientIp } = await import("@/server/client-ip");
const { authOptions } = await import("@/server/auth-options");
const { ipBucketFor } = await import("@/server/account-guards");

afterEach(() => {
  vi.doUnmock("@/server/auth-options");
  vi.resetModules();
});

function headers(entries: Record<string, string>): Headers {
  return new Headers(entries);
}

describe("isPublicClientIp", () => {
  it.each([
    "8.8.8.8",
    "1.1.1.1",
    "81.2.69.142",
    "185.86.151.11",
    "100.63.255.255",
    "100.128.0.0",
    "172.15.255.255",
    "172.32.0.0",
    "198.17.255.255",
    "198.20.0.0",
    "223.255.255.255",
    "2a00:1450:4001::1",
    "2001:4860:4860::8888",
    "2a00:1450:4001:0000:0000:0000:0000:0000",
    "2620:0:ccc::2",
  ])("accepts the public address %s", (ip) => {
    expect(isPublicClientIp(ip)).toBe(true);
  });

  it.each([
    ["this network", "0.0.0.0"],
    ["this network", "0.255.255.255"],
    ["private 10/8", "10.0.0.1"],
    ["private 172.16/12", "172.16.0.1"],
    ["private 172.16/12 end", "172.31.255.255"],
    ["private 192.168/16", "192.168.1.10"],
    ["carrier-grade NAT", "100.64.0.1"],
    ["carrier-grade NAT end", "100.127.255.255"],
    ["loopback", "127.0.0.1"],
    ["link-local", "169.254.169.254"],
    ["IETF assignments", "192.0.0.8"],
    ["documentation TEST-NET-1", "192.0.2.1"],
    ["6to4 relay", "192.88.99.1"],
    ["benchmarking", "198.18.0.1"],
    ["benchmarking end", "198.19.255.255"],
    ["documentation TEST-NET-2", "198.51.100.7"],
    ["documentation TEST-NET-3", "203.0.113.9"],
    ["multicast", "224.0.0.1"],
    ["multicast end", "239.255.255.255"],
    ["reserved", "240.0.0.1"],
    ["broadcast", "255.255.255.255"],
    ["IPv6 unspecified", "::"],
    ["IPv6 loopback", "::1"],
    ["IPv6 /64-masked unspecified", "0000:0000:0000:0000:0000:0000:0000:0000"],
    ["IPv6 link-local", "fe80::1"],
    ["IPv6 link-local with zone", "fe80::1%eth0"],
    ["IPv6 unique-local", "fd12:3456:789a::1"],
    ["IPv6 multicast", "ff02::1"],
    ["IPv6 mapped private", "::ffff:10.0.0.1"],
    ["IPv6 mapped public (not normalized)", "::ffff:8.8.8.8"],
    ["NAT64", "64:ff9b::808:808"],
    ["IPv6 documentation", "2001:db8::1"],
    ["IPv6 documentation 3fff", "3fff:0fff::1"],
    ["Teredo", "2001:0:4136:e378:8000:63bf:3fff:fdd2"],
    ["IETF protocol range", "2001:1::1"],
    ["6to4", "2002:808:808::1"],
    ["embedded dotted quad", "2a00:1450::8.8.8.8"],
  ])("rejects %s (%s)", (_label, ip) => {
    expect(isPublicClientIp(ip)).toBe(false);
  });

  it.each([
    "",
    " ",
    "unknown",
    "not-an-ip",
    "8.8.8",
    "8.8.8.8.8",
    "8.8.8.256",
    "08.8.8.8",
    "8.8.8.8 ",
    " 8.8.8.8",
    "8.8.8.8, 1.1.1.1",
    "8.8.8.8:443",
    "[2a00:1450:4001::1]",
    "2a00:1450:4001::1::1",
    "2a00:1450:4001:1:1:1:1:1:1",
    "gggg::1",
    "1".repeat(100),
  ])("rejects the malformed value %j", (ip) => {
    expect(isPublicClientIp(ip)).toBe(false);
  });

  it("rejects non-string input without throwing", () => {
    expect(isPublicClientIp(undefined as unknown as string)).toBe(false);
    expect(isPublicClientIp(null as unknown as string)).toBe(false);
    expect(isPublicClientIp(8888 as unknown as string)).toBe(false);
  });
});

describe("resolveClientIp", () => {
  it("returns the single X-Forwarded-For address", () => {
    expect(resolveClientIp(headers({ "x-forwarded-for": "8.8.8.8" }))).toBe("8.8.8.8");
  });

  it("accepts a Request as well as Headers", () => {
    const request = new Request("https://runespace.qcfailed.com/", {
      headers: { "x-forwarded-for": "81.2.69.142" },
    });
    expect(resolveClientIp(request)).toBe("81.2.69.142");
  });

  it("normalizes IPv6 exactly as the abuse limiter's resolver does (/64)", () => {
    expect(resolveClientIp(headers({ "x-forwarded-for": "2a00:1450:4001::abcd" }))).toBe(
      "2a00:1450:4001:0000:0000:0000:0000:0000",
    );
  });

  it("unwraps an IPv4-mapped IPv6 address", () => {
    expect(resolveClientIp(headers({ "x-forwarded-for": "::ffff:8.8.8.8" }))).toBe("8.8.8.8");
  });

  it("is unknown for a missing header, with no development loopback fallback", () => {
    expect(resolveClientIp(headers({}))).toBeNull();
  });

  it("is unknown for a missing request", () => {
    expect(resolveClientIp(undefined)).toBeNull();
  });

  it("is unknown for a multi-entry header, as for the abuse limiter", () => {
    expect(resolveClientIp(headers({ "x-forwarded-for": "8.8.8.8, 1.1.1.1" }))).toBeNull();
    expect(resolveClientIp(headers({ "x-forwarded-for": "1.2.3.4, 8.8.8.8" }))).toBeNull();
  });

  it.each(["10.0.0.1", "127.0.0.1", "192.168.0.5", "100.64.0.9", "fd00::1", "203.0.113.5", "junk"])(
    "is unknown for the unsuitable forwarded value %s",
    (value) => {
      expect(resolveClientIp(headers({ "x-forwarded-for": value }))).toBeNull();
    },
  );

  it.each([
    ["cf-ipcountry", "US"],
    ["cf-connecting-ip", "8.8.8.8"],
    ["x-real-ip", "8.8.8.8"],
    ["forwarded", "for=8.8.8.8"],
    ["true-client-ip", "8.8.8.8"],
    ["x-client-ip", "8.8.8.8"],
  ])("ignores the %s header", (name, value) => {
    expect(resolveClientIp(headers({ [name]: value }))).toBeNull();
  });

  it("is exactly the shared authOptions' IP configuration (no override, so Better Auth defaults)", () => {
    expect((authOptions as BetterAuthOptions).advanced?.ipAddress).toBeUndefined();
  });

  it("takes no options argument, so no caller can select another IP configuration", () => {
    expect(resolveClientIp.length).toBe(1);
    const source = readFileSync(path.join(process.cwd(), "server", "client-ip.ts"), "utf8");
    expect(source).toMatch(/getIp\(source, authOptions\)/);
    expect(source).not.toMatch(/BetterAuthOptions/);
  });

  it.each([
    ["a single public address", "8.8.8.8"],
    ["a public IPv6 address", "2a00:1450:4001::abcd"],
    ["an IPv4-mapped address", "::ffff:8.8.8.8"],
    ["a multi-entry header", "8.8.8.8, 1.1.1.1"],
    ["a private address", "10.0.0.1"],
    ["junk", "not-an-ip"],
    ["an empty value", ""],
  ])("agrees with the abuse limiter's address for %s", (_label, value) => {
    const source = headers({ "x-forwarded-for": value });
    const bucket = ipBucketFor(source, authOptions);
    const resolved = resolveClientIp(source);
    // The limiter keeps any resolvable address (and buckets the rest as
    // "unknown"); the classifier uses the same address or declines it.
    if (resolved !== null) expect(resolved).toBe(bucket);
    if (bucket === "unknown") expect(resolved).toBeNull();
  });

  it("follows the shared options if they ever configure trusted proxies", async () => {
    vi.resetModules();
    vi.doMock("@/server/auth-options", () => ({
      authOptions: { advanced: { ipAddress: { trustedProxies: ["10.0.0.0/8"] } } },
    }));
    const { resolveClientIp: resolveWithProxies } = await import("@/server/client-ip");
    expect(resolveWithProxies(headers({ "x-forwarded-for": "8.8.8.8, 10.0.0.2" }))).toBe("8.8.8.8");
  });

  it("follows the shared options if they ever disable IP tracking", async () => {
    vi.resetModules();
    vi.doMock("@/server/auth-options", () => ({
      authOptions: { advanced: { ipAddress: { disableIpTracking: true } } },
    }));
    const { resolveClientIp: resolveDisabled } = await import("@/server/client-ip");
    expect(resolveDisabled(headers({ "x-forwarded-for": "8.8.8.8" }))).toBeNull();
  });
});
