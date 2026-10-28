import { sanitizeReleaseId } from "@/game/schemas/diagnostics";

/**
 * Detecting that an already-open tab is running a build the server has moved
 * past (issue #412). The identity is the existing `RUNESPACE_RELEASE_ID`: the
 * server renders its runtime value into the document, and `/api/build-info`
 * reports the live one. There is no second version system, and no build-time
 * variable is needed (Coolify configures the release at runtime only, so
 * `NEXT_PUBLIC_RUNESPACE_RELEASE_ID` is empty in the browser).
 *
 * This module is the pure part: it never touches React, and every browser
 * dependency is injected so the loop-safety and "ignore unknowns" rules are
 * unit-testable. `ReleaseWatcher` wires it to the page.
 */

export const BUILD_INFO_PATH = "/api/build-info";
/** A visible tab asks this often; a hidden one asks on resume instead. */
export const RELEASE_POLL_INTERVAL_MS = 60_000;
const BUILD_INFO_TIMEOUT_MS = 10_000;
/**
 * One automatic reload per target release per window. If the reloaded document
 * still reports an older release (replicas mid-rollout, a cached document),
 * the next attempt for the same target waits this long instead of looping.
 */
export const RELOAD_COOLDOWN_MS = 10 * 60_000;
export const RELOAD_RECORD_KEY = "runespace-release-reload";

/**
 * A release identity that can be compared: a sanitized id, and never the
 * explicit "unknown" the endpoint reports when the deployment has none. An
 * unknown identity on either side means "cannot tell", never "deployed".
 */
export function comparableRelease(value: unknown): string | undefined {
  const release = sanitizeReleaseId(value);
  return release && release !== "unknown" ? release : undefined;
}

let documentRelease: string | undefined | null = null;

/**
 * The release that served this document, fixed by the first value the page
 * shows. The module survives client-side navigation inside one document, so a
 * later page whose server payload comes from a newer release cannot overwrite
 * the identity of the JavaScript that is actually running. A full reload loads
 * a fresh module and captures again.
 */
export function captureDocumentRelease(rendered: unknown): string | undefined {
  if (documentRelease === null) documentRelease = comparableRelease(rendered);
  return documentRelease;
}

/** The live release, or `undefined` for any failure or unknown identity. */
export async function fetchLiveRelease(
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<string | undefined> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BUILD_INFO_TIMEOUT_MS);
  try {
    const response = await fetchImpl(BUILD_INFO_PATH, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { releaseId?: unknown } | null;
    return comparableRelease(body?.releaseId);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

type ReloadStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * Claims the one automatic reload for `target`. False means do not reload:
 * this target was already tried inside the cooldown, or the attempt cannot be
 * recorded (without a record across the reload, a loop could not be detected).
 */
export function claimReload(storage: ReloadStorage | undefined, target: string, now: number) {
  if (!storage) return false;
  try {
    const raw = storage.getItem(RELOAD_RECORD_KEY);
    if (raw) {
      const record = JSON.parse(raw) as { target?: unknown; at?: unknown };
      if (
        record.target === target &&
        typeof record.at === "number" &&
        now - record.at < RELOAD_COOLDOWN_MS
      )
        return false;
    }
    storage.setItem(RELOAD_RECORD_KEY, JSON.stringify({ target, at: now }));
    return true;
  } catch {
    return false;
  }
}

/** True while the player is composing text a reload would discard. */
export function editingText(doc: Pick<Document, "activeElement"> = document): boolean {
  const element = doc.activeElement as
    | (HTMLElement & { value?: unknown; isContentEditable?: boolean })
    | null;
  if (!element) return false;
  const tag = element.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA")
    return typeof element.value === "string" && element.value.length > 0;
  return Boolean(element.isContentEditable) && (element.textContent ?? "").length > 0;
}
