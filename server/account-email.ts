import type { TransactionalMessage } from "@/server/transactional-mail";

/**
 * Rendered account emails (issue #221). Plain-text first with a minimal HTML
 * twin; every player-supplied value is HTML-escaped. Copy stays strictly
 * transactional.
 */

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function verificationEmail(input: {
  to: string;
  playerName: string | null | undefined;
  url: string;
}): TransactionalMessage {
  const greeting = input.playerName ? `Hi ${input.playerName},` : "Hi,";
  const text = [
    greeting,
    "",
    "Confirm this email address to finish creating your RuneSpace account and unlock character creation:",
    "",
    input.url,
    "",
    "This link expires in 1 hour. You can request a new one from the sign-in page.",
    "",
    "If you didn't create a RuneSpace account, you can ignore this email.",
    "",
    "— RuneSpace by QC Failed",
  ].join("\n");
  const url = escapeHtml(input.url);
  const html = [
    `<p>${escapeHtml(greeting)}</p>`,
    "<p>Confirm this email address to finish creating your RuneSpace account and unlock character creation:</p>",
    `<p><a href="${url}">Verify my email</a></p>`,
    `<p>Or paste this link into your browser:<br>${url}</p>`,
    "<p>This link expires in 1 hour. You can request a new one from the sign-in page.</p>",
    "<p>If you didn't create a RuneSpace account, you can ignore this email.</p>",
    "<p>— RuneSpace by QC Failed</p>",
  ].join("\n");
  return {
    kind: "account-verification",
    to: input.to,
    subject: "Verify your RuneSpace account",
    text,
    html,
  };
}
