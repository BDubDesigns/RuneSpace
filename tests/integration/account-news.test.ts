import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { cleanupTestUser, createCharacterForUser, createTestUser } from "./fixtures";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Integration tests for the account-level news read-through boundary (issue
 * #156), run against a real PostgreSQL instance. These prove the boundary is
 * actually persisted on `player_accounts` (never per-character, never a
 * second notification table), that acknowledgement records the newest
 * currently-published Update's instant rather than wall-clock time, and that
 * the write is monotonic/idempotent.
 *
 * Run locally through the disposable wrapper: pnpm test:integration
 */
suite("account-level news read-through (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let accountNews: typeof import("@/server/account-news");
  let publicUpdates: typeof import("@/features/public-site/public-updates");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    accountNews = await import("@/server/account-news");
    publicUpdates = await import("@/features/public-site/public-updates");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  async function makeUser(displayName: string) {
    const userId = await createTestUser(db, authSchema, displayName, `${randomUUID()}@example.com`);
    createdUsers.push(userId);
    return userId;
  }

  it("is unread by default for an account that has never acknowledged news", async () => {
    const userId = await makeUser("Never Acknowledged");
    const account = await ownership.ensurePlayerAccount(userId);

    expect(account.newsReadThroughAt).toBeNull();
    expect(accountNews.getAccountNewsUnread(account)).toBe(true);
  });

  it("acknowledging news records the newest published Update's instant, not wall-clock time", async () => {
    const userId = await makeUser("Acknowledger");
    await ownership.ensurePlayerAccount(userId);
    const before = Date.now();

    await accountNews.acknowledgeNews(userId);

    const [row] = await db
      .select()
      .from(rune.playerAccounts)
      .where(eq(rune.playerAccounts.userId, userId));
    const latest = publicUpdates.getLatestPublishedUpdate();
    expect(row?.newsReadThroughAt?.getTime()).toBe(Date.parse(latest.publishedAt));
    // The stored boundary is the Update's publication instant, which is a
    // fixed authored timestamp — it is not simply "now" at acknowledgement.
    expect(row?.newsReadThroughAt?.getTime()).not.toBe(before);
    expect(accountNews.getAccountNewsUnread(row!)).toBe(false);
  });

  it("is idempotent: acknowledging twice converges on the same boundary", async () => {
    const userId = await makeUser("Repeat Acknowledger");
    await ownership.ensurePlayerAccount(userId);

    await accountNews.acknowledgeNews(userId);
    const [first] = await db
      .select()
      .from(rune.playerAccounts)
      .where(eq(rune.playerAccounts.userId, userId));

    await accountNews.acknowledgeNews(userId);
    const [second] = await db
      .select()
      .from(rune.playerAccounts)
      .where(eq(rune.playerAccounts.userId, userId));

    expect(second?.newsReadThroughAt?.getTime()).toBe(first?.newsReadThroughAt?.getTime());
  });

  it("shares one news state across multiple characters under the same account", async () => {
    const userId = await makeUser("Multi Character");
    const account = await ownership.ensurePlayerAccount(userId);
    await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Alpha${randomUUID().slice(0, 6)}`,
    );
    await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Beta${randomUUID().slice(0, 6)}`,
    );

    // Before acknowledgement both characters' shared account is unread.
    expect(accountNews.getAccountNewsUnread(account)).toBe(true);

    await accountNews.acknowledgeNews(userId);

    // The read-through boundary lives once on the account row: re-loading it
    // (as either character's Play page would) reflects the same read state
    // regardless of which character is active.
    const [refreshed] = await db
      .select()
      .from(rune.playerAccounts)
      .where(eq(rune.playerAccounts.userId, userId));
    expect(accountNews.getAccountNewsUnread(refreshed!)).toBe(false);
  });
});
