import type { TransactionalMessage } from "@/server/transactional-mail";

/**
 * Zoho ZeptoMail Send Mail API client (issue #221). The only file that knows
 * ZeptoMail's request shape; `server/transactional-mail.ts` is the only
 * caller. ZeptoMail carries transactional account mail only — there is no
 * marketing, newsletter, or broadcast path through this module.
 */

export type ZeptoMailSender = { address: string; name: string };

export type ZeptoMailPayload = {
  from: { address: string; name: string };
  to: { email_address: { address: string } }[];
  subject: string;
  textbody: string;
  htmlbody: string;
  track_clicks: false;
  track_opens: false;
  client_reference: string;
};

/** Build the Send Mail request body. Pure, so it is unit-tested without a provider. */
export function buildZeptoMailPayload(
  message: TransactionalMessage,
  sender: ZeptoMailSender,
): ZeptoMailPayload {
  return {
    from: { address: sender.address, name: sender.name },
    to: [{ email_address: { address: message.to } }],
    subject: message.subject,
    textbody: message.text,
    htmlbody: message.html,
    // Account-security mail: no open pixels, and links stay exactly as issued.
    track_clicks: false,
    track_opens: false,
    client_reference: message.kind,
  };
}

/** ZeptoMail tokens are issued with their scheme prefix; accept either form. */
export function zeptoMailAuthorization(token: string): string {
  return token.startsWith("Zoho-enczapikey ") ? token : `Zoho-enczapikey ${token}`;
}

export async function sendViaZeptoMail(
  message: TransactionalMessage,
  config: { apiUrl: string; token: string; sender: ZeptoMailSender },
): Promise<void> {
  const response = await fetch(config.apiUrl, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: zeptoMailAuthorization(config.token),
    },
    body: JSON.stringify(buildZeptoMailPayload(message, config.sender)),
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    // The error body names the failing field/code; it never echoes the token.
    const detail = await response.text().catch(() => "");
    throw new Error(
      `ZeptoMail rejected ${message.kind} (${response.status}): ${detail.slice(0, 300)}`,
    );
  }
}
