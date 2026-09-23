import { readFileSync } from "node:fs";
import { expect, type BrowserContext, type Page } from "@playwright/test";
import { E2E_TURNSTILE_PASS_TOKEN } from "@/server/local-e2e";

/**
 * Browser helpers for the real registration → verification journey (issue
 * #221).
 *
 * - Turnstile: Cloudflare's widget script is replaced by a local stand-in
 *   that immediately issues the runner's fixed pass token. The server still
 *   verifies it through Better Auth's Captcha plugin, redirected by the
 *   runner to the gated loopback stub, so no test calls Cloudflare.
 * - Mail: inside the local-E2E gate the server writes verification email to
 *   the run-scoped outbox file named by `RUNESPACE_E2E_MAIL_OUTBOX_FILE`.
 *   Specs follow the exact link the player would receive; nothing mints or
 *   bypasses a verification token.
 */

const FAKE_TURNSTILE_SCRIPT = `
window.turnstile = {
  render(element, options) {
    element.setAttribute("data-e2e-turnstile", "issued");
    setTimeout(() => options.callback(${JSON.stringify(E2E_TURNSTILE_PASS_TOKEN)}), 0);
    return "e2e-" + Math.random().toString(36).slice(2);
  },
  remove() {},
};
`;

export async function stubTurnstile(target: Page | BrowserContext): Promise<void> {
  await target.route(
    (url) => url.hostname === "challenges.cloudflare.com",
    (route) =>
      route.fulfill({ status: 200, contentType: "text/javascript", body: FAKE_TURNSTILE_SCRIPT }),
  );
}

type OutboxMessage = { kind: string; to: string; text: string };

function outboxPath(): string {
  const path = process.env.RUNESPACE_E2E_MAIL_OUTBOX_FILE;
  if (!path)
    throw new Error("RUNESPACE_E2E_MAIL_OUTBOX_FILE is not set; run through an E2E runner");
  return path;
}

/** Every verification email captured for an address, oldest first. */
export function verificationEmailsFor(email: string): OutboxMessage[] {
  let raw = "";
  try {
    raw = readFileSync(outboxPath(), "utf8");
  } catch {
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as OutboxMessage)
    .filter((message) => message.kind === "account-verification" && message.to === email);
}

function linkIn(message: OutboxMessage): string {
  const link = message.text.match(/https?:\/\/\S+\/api\/auth\/verify-email\?\S+/)?.[0];
  if (!link) throw new Error("verification email contains no verification link");
  return link;
}

/** Wait for the `count`-th verification email to an address and return its link. */
export async function waitForVerificationLink(email: string, count = 1): Promise<string> {
  await expect
    .poll(() => verificationEmailsFor(email).length, { timeout: 10_000 })
    .toBeGreaterThanOrEqual(count);
  return linkIn(verificationEmailsFor(email)[count - 1]!);
}

/**
 * Present this page as its own client address. Production requests reach the
 * app through the proxy's `X-Forwarded-For`; giving each registering journey a
 * distinct benchmark-range (198.18.0.0/15) address keeps the per-IP signup and
 * mail limits independent between specs, exactly as between real players.
 */
export async function useDistinctClientIp(page: Page): Promise<string> {
  const octet = () => Math.floor(Math.random() * 254) + 1;
  const ip = `198.${18 + Math.floor(Math.random() * 2)}.${octet()}.${octet()}`;
  await page.setExtraHTTPHeaders({ "x-forwarded-for": ip });
  return ip;
}

/** Fill and submit the registration form; lands on "Check your email". */
export async function submitRegistration(
  page: Page,
  input: { playerName: string; email: string; password: string },
): Promise<void> {
  await stubTurnstile(page);
  await useDistinctClientIp(page);
  await page.goto("/register");
  await expect(
    page.getByRole("heading", { name: "Reserve your place in RuneSpace" }),
  ).toBeVisible();
  await page.getByLabel("Player name").fill(input.playerName);
  await page.getByLabel("Email").fill(input.email);
  await page.getByLabel("Password", { exact: true }).fill(input.password);
  await expect(page.locator("[data-e2e-turnstile=issued]")).toHaveCount(1);
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
}

/**
 * Register through the real form, then open the emailed verification link:
 * Better Auth verifies the address, signs the player in, and lands on
 * `/characters`.
 */
export async function registerVerifiedAccount(
  page: Page,
  input: { playerName: string; email: string; password: string },
): Promise<void> {
  await submitRegistration(page, input);
  await page.goto(await waitForVerificationLink(input.email));
  await page.waitForURL("**/characters");
  await expect(page.getByRole("heading", { name: "Characters" })).toBeVisible();
}

/** A per-run Player name inside the 20-character limit. */
export function uniquePlayerName(prefix: string): string {
  return `${prefix.slice(0, 13)} ${Math.random().toString(36).slice(2, 8)}`;
}
