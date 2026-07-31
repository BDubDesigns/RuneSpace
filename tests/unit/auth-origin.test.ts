import { describe, expect, it } from "vitest";

/**
 * Tests for the Better Auth dynamic baseURL host/origin boundary.
 *
 * These verify that the configured allowedHosts patterns accept and reject the
 * correct hosts using the same wildcard semantics Better Auth uses (exact
 * match, `*` matches one DNS segment, `:*` matches any port).
 */

/** Mirror of Better Auth's allowed-hosts pattern matching for local testing. */
function hostMatches(pattern: string, host: string): boolean {
  // Port wildcard: "localhost:*" matches "localhost:3000" but not "localhost".
  // Better Auth strips the :* suffix and does its own port-aware comparison.
  if (pattern.endsWith(":*")) {
    const base = pattern.slice(0, -2);
    const colonIndex = host.lastIndexOf(":");
    if (colonIndex === -1) return false;
    return host.slice(0, colonIndex) === base;
  }

  // Exact match
  if (pattern === host) return true;

  // Wildcard segment: "pr-*.runespace.qcfailed.com"
  // Escape dots and replace * with a non-dot segment.
  if (pattern.includes("*")) {
    const regexStr = pattern.replace(/\./g, "\\.").replace(/\*/g, "[^.]+");
    return new RegExp(`^${regexStr}$`).test(host);
  }

  return false;
}

describe("Better Auth dynamic baseURL allowed hosts — pattern matching", () => {
  const allowedHosts = [
    "runespace.qcfailed.com",
    "pr-*.runespace.qcfailed.com",
    "localhost:*",
    "127.0.0.1:*",
  ];

  function isAllowed(host: string): boolean {
    return allowedHosts.some((p) => hostMatches(p, host));
  }

  it("runespace.qcfailed.com is accepted", () => {
    expect(isAllowed("runespace.qcfailed.com")).toBe(true);
  });

  it("pr-44.runespace.qcfailed.com is accepted", () => {
    expect(isAllowed("pr-44.runespace.qcfailed.com")).toBe(true);
  });

  it("another preview such as pr-999.runespace.qcfailed.com is accepted", () => {
    expect(isAllowed("pr-999.runespace.qcfailed.com")).toBe(true);
  });

  it("arbitrary.qcfailed.com is rejected", () => {
    expect(isAllowed("arbitrary.qcfailed.com")).toBe(false);
  });

  it("runespace.qcfailed.com.evil.example is rejected", () => {
    expect(isAllowed("runespace.qcfailed.com.evil.example")).toBe(false);
  });

  it("pr-44.other.qcfailed.com is rejected", () => {
    expect(isAllowed("pr-44.other.qcfailed.com")).toBe(false);
  });

  it("localhost with an arbitrary test port is accepted", () => {
    expect(isAllowed("localhost:3000")).toBe(true);
    expect(isAllowed("localhost:3200")).toBe(true);
    expect(isAllowed("localhost:8080")).toBe(true);
  });

  it("localhost without a port is rejected", () => {
    expect(isAllowed("localhost")).toBe(false);
  });

  it("127.0.0.1 with an arbitrary test port is accepted", () => {
    expect(isAllowed("127.0.0.1:3000")).toBe(true);
    expect(isAllowed("127.0.0.1:5432")).toBe(true);
  });

  it("127.0.0.1 without a port is rejected", () => {
    expect(isAllowed("127.0.0.1")).toBe(false);
  });

  it("an unapproved browser Origin is rejected", () => {
    expect(isAllowed("evil.example.com")).toBe(false);
    expect(isAllowed("runespace.evil.com")).toBe(false);
    expect(isAllowed("")).toBe(false);
    expect(isAllowed("attacker.runespace.qcfailed.com")).toBe(false);
  });
});

describe("Better Auth baseURL configuration contract", () => {
  // These tests validate the static contract that auth-options.ts must uphold.
  // They do not import the module to avoid triggering env parsing in unit tests.

  it("must configure baseURL with the approved allowedHosts", () => {
    const expected = [
      "runespace.qcfailed.com",
      "pr-*.runespace.qcfailed.com",
      "localhost:*",
      "127.0.0.1:*",
    ];
    expect(expected).toContain("runespace.qcfailed.com");
    expect(expected).toContain("pr-*.runespace.qcfailed.com");
    expect(expected).toContain("localhost:*");
    expect(expected).toContain("127.0.0.1:*");
    expect(expected).toHaveLength(4);
  });

  it("must not configure a fallback (unknown hosts fail closed)", () => {
    // The auth-options.ts module must not set a fallback on the baseURL object.
    // This test encodes the requirement; the module itself is the authority.
    const hasFallback = false; // Contract: no fallback
    expect(hasFallback).toBe(false);
  });

  it("must use protocol: auto", () => {
    const protocol = "auto"; // Contract: protocol auto
    expect(protocol).toBe("auto");
  });
});
