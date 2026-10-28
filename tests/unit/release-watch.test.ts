// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RELOAD_COOLDOWN_MS,
  RELOAD_RECORD_KEY,
  claimReload,
  comparableRelease,
  editingText,
  fetchLiveRelease,
} from "@/features/deployment/release-watch";

const RELEASE_A = "0123456789abcdef0123456789abcdef01234567";
const RELEASE_B = "fedcba9876543210fedcba9876543210fedcba98";

function memoryStorage(initial: Record<string, string> = {}) {
  const items = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => items.get(key) ?? null,
    setItem: (key: string, value: string) => void items.set(key, value),
  };
}

function respond(body: unknown, init: { ok?: boolean } = {}) {
  return vi.fn(async () => ({ ok: init.ok ?? true, json: async () => body }) as Response);
}

describe("comparableRelease", () => {
  it("accepts a sanitized release and rejects everything that cannot be compared", () => {
    expect(comparableRelease(RELEASE_A)).toBe(RELEASE_A);
    expect(comparableRelease("unknown")).toBeUndefined();
    expect(comparableRelease("")).toBeUndefined();
    expect(comparableRelease(undefined)).toBeUndefined();
    expect(comparableRelease(42)).toBeUndefined();
    expect(comparableRelease("not a real revision!")).toBeUndefined();
  });
});

describe("captureDocumentRelease", () => {
  beforeEach(() => vi.resetModules());

  it("keeps the release that first rendered the document, even if a later payload differs", async () => {
    const { captureDocumentRelease } = await import("@/features/deployment/release-watch");
    expect(captureDocumentRelease(RELEASE_A)).toBe(RELEASE_A);
    // A client navigation after a deployment renders from release B; the running code is still A.
    expect(captureDocumentRelease(RELEASE_B)).toBe(RELEASE_A);
  });

  it("stays unknown rather than adopting a later identity", async () => {
    const { captureDocumentRelease } = await import("@/features/deployment/release-watch");
    expect(captureDocumentRelease(undefined)).toBeUndefined();
    expect(captureDocumentRelease(RELEASE_B)).toBeUndefined();
  });
});

describe("fetchLiveRelease", () => {
  it("returns the live release from an uncached request", async () => {
    const fetchImpl = respond({ releaseId: RELEASE_B });
    await expect(fetchLiveRelease(fetchImpl as unknown as typeof fetch)).resolves.toBe(RELEASE_B);
    expect(fetchImpl).toHaveBeenCalledWith(
      "/api/build-info",
      expect.objectContaining({ cache: "no-store" }),
    );
  });

  it.each([
    ["an unknown identity", respond({ releaseId: "unknown" })],
    ["a failed response", respond({ releaseId: RELEASE_B }, { ok: false })],
    ["a malformed body", respond(null)],
    ["a missing field", respond({})],
    ["an invalid identity", respond({ releaseId: "<script>" })],
    [
      "a malformed JSON document",
      vi.fn(async () => ({ ok: true, json: async () => Promise.reject(new SyntaxError()) })),
    ],
    ["a network failure", vi.fn(async () => Promise.reject(new TypeError("Failed to fetch")))],
  ])("ignores %s instead of assuming a deployment", async (_name, fetchImpl) => {
    await expect(fetchLiveRelease(fetchImpl as unknown as typeof fetch)).resolves.toBeUndefined();
  });
});

describe("claimReload", () => {
  const now = 1_000_000;

  it("allows the first reload for a release and records it", () => {
    const storage = memoryStorage();
    expect(claimReload(storage, RELEASE_B, now)).toBe(true);
    expect(JSON.parse(storage.getItem(RELOAD_RECORD_KEY)!)).toEqual({ target: RELEASE_B, at: now });
  });

  it("refuses a second reload to the same release inside the cooldown", () => {
    const storage = memoryStorage();
    expect(claimReload(storage, RELEASE_B, now)).toBe(true);
    expect(claimReload(storage, RELEASE_B, now + 1)).toBe(false);
    expect(claimReload(storage, RELEASE_B, now + RELOAD_COOLDOWN_MS - 1)).toBe(false);
  });

  it("tries again once the cooldown has passed, and allows a newer release at once", () => {
    const storage = memoryStorage();
    claimReload(storage, RELEASE_B, now);
    expect(claimReload(storage, RELEASE_B, now + RELOAD_COOLDOWN_MS)).toBe(true);
    expect(claimReload(storage, RELEASE_A, now + RELOAD_COOLDOWN_MS + 1)).toBe(true);
  });

  it("refuses when the attempt cannot be recorded, because a loop could not then be detected", () => {
    expect(claimReload(undefined, RELEASE_B, now)).toBe(false);
    const failing = {
      getItem: () => null,
      setItem: () => {
        throw new DOMException("quota", "QuotaExceededError");
      },
    };
    expect(claimReload(failing, RELEASE_B, now)).toBe(false);
  });

  it("treats an unreadable record as no record", () => {
    const storage = memoryStorage({ [RELOAD_RECORD_KEY]: "{not json" });
    expect(claimReload(storage, RELEASE_B, now)).toBe(false);
  });
});

describe("editingText", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("is true only while the focused field holds text a reload would discard", () => {
    document.body.innerHTML = '<input id="chat" /><button id="go">Go</button>';
    const input = document.getElementById("chat") as HTMLInputElement;
    input.focus();
    expect(editingText()).toBe(false);
    input.value = "meet at the Jag";
    expect(editingText()).toBe(true);
    (document.getElementById("go") as HTMLButtonElement).focus();
    expect(editingText()).toBe(false);
  });
});
