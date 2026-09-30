import { sql } from "drizzle-orm";
import type { db } from "@/db";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Names the chat send lock; the second key is the account. */
const CHAT_SEND_LOCK_NAMESPACE = 246;

/**
 * Take one account's transaction-scoped chat send lock (#246). Every chat send
 * of that account holds it, so its tabs, devices, and characters share one
 * serialized budget; a Block of that account (#247) takes it too, so it is
 * ordered after any Whisper the account already has in flight.
 */
export async function lockAccountChatSends(tx: Pick<Transaction, "execute">, accountId: string) {
  await tx.execute(
    sql`select pg_advisory_xact_lock(${CHAT_SEND_LOCK_NAMESPACE}, hashtext(${accountId}))`,
  );
}
