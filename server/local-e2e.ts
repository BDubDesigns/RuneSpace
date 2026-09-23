/**
 * The repository's local-E2E runtime gate for the account boundary (issue
 * #221): `CI=true`, the plain-HTTP runner flag, and a loopback database — the
 * same three conditions the Power Annex test clock and the deterministic
 * Mining RNG already require. Only the repository's own disposable E2E runners
 * satisfy all three; previews and production never do.
 *
 * Inside the gate the E2E runners may redirect Turnstile site verification to
 * a loopback stub and capture verification mail in a run-scoped outbox file,
 * so browser journeys never call Cloudflare or ZeptoMail.
 */
export function isLocalE2eRuntime(): boolean {
  let databaseHost: string | undefined;
  try {
    databaseHost = process.env.DATABASE_URL
      ? new URL(process.env.DATABASE_URL).hostname
      : undefined;
  } catch {
    return false;
  }
  return (
    process.env.CI === "true" &&
    process.env.RUNESPACE_E2E_CANONICAL_HTTP === "true" &&
    (databaseHost === "localhost" || databaseHost === "127.0.0.1")
  );
}

/** A loopback `http:` URL, or undefined — E2E redirects never leave the machine. */
export function loopbackUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost")
      ? url.toString()
      : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The only token the loopback Turnstile stub accepts
 * (`app/api/e2e/turnstile-siteverify/route.ts`). E2E journeys serve a fake
 * Turnstile script that issues it, so no browser test loads Cloudflare.
 */
export const E2E_TURNSTILE_PASS_TOKEN = "e2e-turnstile-pass";
