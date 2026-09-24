import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { env } from "@/server/env";
import { isLocalE2eRuntime } from "@/server/local-e2e";
import { sendViaZeptoMail } from "@/server/zeptomail";

/**
 * RuneSpace's transactional-mail boundary (issue #221).
 *
 * Better Auth callbacks hand a fully rendered `TransactionalMessage` to
 * `sendTransactionalMail`; nothing outside this module and `server/zeptomail.ts`
 * knows which provider carries it. `kind` is a closed union of account
 * messages: marketing, newsletter, and development-update mail have no kind
 * and therefore no path through ZeptoMail.
 *
 * Exactly one transport is selected per environment:
 *
 * | Environment                              | Transport                     |
 * | ---------------------------------------- | ----------------------------- |
 * | Local E2E runner gate + outbox file      | `e2e-outbox` (JSON lines)     |
 * | `NODE_ENV=test` (Vitest)                 | `test-capture` (in memory)    |
 * | ZeptoMail token + sender configured      | `zeptomail`                   |
 * | `NODE_ENV=development`, no ZeptoMail     | `development-log` (console)   |
 * | anything else (e.g. unconfigured prod)   | none — fail closed            |
 */

export type TransactionalMessageKind = "account-verification";

export type TransactionalMessage = {
  kind: TransactionalMessageKind;
  to: string;
  subject: string;
  text: string;
  html: string;
};

export type MailTransportKind = "e2e-outbox" | "test-capture" | "zeptomail" | "development-log";

type MailTransport = {
  kind: MailTransportKind;
  send(message: TransactionalMessage): Promise<void>;
};

const testMailbox: TransactionalMessage[] = [];

/** Messages captured by the Vitest transport, oldest first. */
export function readTestMailbox(): readonly TransactionalMessage[] {
  return testMailbox;
}

export function clearTestMailbox(): void {
  testMailbox.length = 0;
}

export function resolveMailTransport(): MailTransport | null {
  const outboxFile = process.env.RUNESPACE_E2E_MAIL_OUTBOX_FILE;
  if (outboxFile && isLocalE2eRuntime()) {
    return {
      kind: "e2e-outbox",
      async send(message) {
        mkdirSync(dirname(outboxFile), { recursive: true });
        appendFileSync(outboxFile, `${JSON.stringify({ ...message, sentAt: new Date() })}\n`);
      },
    };
  }
  if (env.NODE_ENV === "test") {
    return {
      kind: "test-capture",
      async send(message) {
        testMailbox.push(message);
      },
    };
  }
  const token = env.ZEPTOMAIL_SEND_MAIL_TOKEN;
  const address = env.RUNESPACE_MAIL_FROM_ADDRESS;
  if (token && address) {
    const config = {
      apiUrl: env.ZEPTOMAIL_API_URL,
      token,
      sender: { address, name: env.RUNESPACE_MAIL_FROM_NAME },
    };
    return { kind: "zeptomail", send: (message) => sendViaZeptoMail(message, config) };
  }
  if (env.NODE_ENV === "development") {
    return {
      kind: "development-log",
      async send(message) {
        console.info(
          `[transactional-mail] ZeptoMail is not configured; ${message.kind} for ${message.to}:\n${message.text}`,
        );
      },
    };
  }
  return null;
}

export class TransactionalMailUnavailableError extends Error {
  constructor() {
    super("Transactional mail is not configured for this environment");
    this.name = "TransactionalMailUnavailableError";
  }
}

export async function sendTransactionalMail(message: TransactionalMessage): Promise<void> {
  const transport = resolveMailTransport();
  if (!transport) throw new TransactionalMailUnavailableError();
  await transport.send(message);
}
