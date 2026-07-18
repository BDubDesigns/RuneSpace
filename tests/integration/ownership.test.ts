import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, it, expect, beforeAll } from "vitest";

/**
 * Integration tests for the server-authoritative ownership + character rules,
 * run against a REAL PostgreSQL instance (issue #6 acceptance: "validate against
 * real PostgreSQL").
 *
 * These exercise the actual Drizzle tables, the unique indexes, the FK
 * restriction behavior, and the three-slot rule — not mocks. They are skipped
 * automatically when DATABASE_URL is not set (e.g. in the lightweight CI fast
 * checks). Run locally with:
 *
 *   DATABASE_URL=postgres://runespace:runespace@127.0.0.1:5432/runespace \
 *     pnpm test integration/ownership
 */

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

suite("ownership & character rules (real PostgreSQL)", () => {
  // Lazily imported so the env validation in server/env.ts does not throw when
  // there is no database configured (CI fast-checks have a placeholder only).
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
  });

  async function makeUser(email: string) {
    const id = randomUUID();
    await db.insert(authSchema.user).values({
      id,
      name: "Tester",
      email,
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    return id;
  }

  // Short unique token for character names (validated to <= 24 chars, letters/digits).
  const short = () => Math.random().toString(36).slice(2, 10);

  async function cleanupUser(userId: string) {
    // Ownership FK is RESTRICT; delete children then parents, scoped to this user.
    const accounts = await db
      .select({ id: rune.playerAccounts.id })
      .from(rune.playerAccounts)
      .where(eq(rune.playerAccounts.userId, userId));
    for (const acc of accounts) {
      await db.delete(rune.characters).where(eq(rune.characters.playerAccountId, acc.id));
    }
    await db.delete(rune.playerAccounts).where(eq(rune.playerAccounts.userId, userId));
    await db.delete(authSchema.user).where(eq(authSchema.user.id, userId));
  }

  it("creates exactly one player account per Better Auth user (concurrency-safe)", async () => {
    const userId = await makeUser(`one-${randomUUID()}@example.com`);
    try {
      const a = await ownership.ensurePlayerAccount(userId);
      const b = await ownership.ensurePlayerAccount(userId);
      expect(a.id).toBe(b.id);
      expect(a.userId).toBe(userId);

      const rows = await db
        .select()
        .from(rune.playerAccounts)
        .where(eq(rune.playerAccounts.userId, userId));
      expect(rows).toHaveLength(1);
    } finally {
      await cleanupUser(userId);
    }
  });

  it("enforces three slots and assigns the lowest free slot", async () => {
    const userId = await makeUser(`slots-${randomUUID()}@example.com`);
    const base = `Slot ${short()}`;
    try {
      const account = await ownership.ensurePlayerAccount(userId);
      const c1 = await characters.createCharacter(account.id, `${base} One`);
      const c2 = await characters.createCharacter(account.id, `${base} Two`);
      const c3 = await characters.createCharacter(account.id, `${base} Three`);
      expect([c1.slot, c2.slot, c3.slot].sort()).toEqual([1, 2, 3]);

      // Fourth creation must be rejected (slots full).
      await expect(characters.createCharacter(account.id, `${base} Four`)).rejects.toThrow(
        /slots are full/i,
      );

      // displayName capitalization preserved; normalized stored for uniqueness.
      expect(c1.displayName).toBe(`${base} One`);
      expect(c1.normalizedName).toBe(`${base.toLowerCase()} one`);
    } finally {
      await cleanupUser(userId);
    }
  });

  it("enforces globally unique character names after normalization", async () => {
    const u1 = await makeUser(`u1-${randomUUID()}@example.com`);
    const u2 = await makeUser(`u2-${randomUUID()}@example.com`);
    // Unique per-run base so the test is isolated from any leftover data in a
    // shared database; the assertion is about a *case/whitespace variant* of
    // the SAME base colliding, which is what the normalization rule guarantees.
    const base = `Hero ${short()}`;
    try {
      const a1 = await ownership.ensurePlayerAccount(u1);
      const a2 = await ownership.ensurePlayerAccount(u2);

      await characters.createCharacter(a1.id, base);
      // Different account, differently-cased/whitespaced name must still collide.
      await expect(characters.createCharacter(a2.id, `  ${base.toLowerCase()} `)).rejects.toThrow(
        /already taken/i,
      );
    } finally {
      await cleanupUser(u1);
      await cleanupUser(u2);
    }
  });

  it("verifies ownership server-side and rejects foreign character ids", async () => {
    const owner = await makeUser(`owner-${randomUUID()}@example.com`);
    const stranger = await makeUser(`stranger-${randomUUID()}@example.com`);
    const name = `Owned ${short()}`;
    try {
      const acc = await ownership.ensurePlayerAccount(owner);
      const char = await characters.createCharacter(acc.id, name);

      // Owner can resolve their own character.
      const ok = await ownership.requireOwnedCharacter(owner, char.id);
      expect(ok.id).toBe(char.id);

      // A stranger (even with a valid-looking id) cannot.
      await expect(ownership.requireOwnedCharacter(stranger, char.id)).rejects.toThrow(
        /not found/i,
      );
    } finally {
      await cleanupUser(owner);
      await cleanupUser(stranger);
    }
  });

  it("restricts deletion: deleting the Better Auth user is blocked while characters exist", async () => {
    const userId = await makeUser(`restrict-${randomUUID()}@example.com`);
    const account = await ownership.ensurePlayerAccount(userId);
    await characters.createCharacter(account.id, `Keep ${short()}`);
    try {
      // The FK is RESTRICT, so removing the user while a character references its
      // account must fail. (Account deletion is out of scope; the point is we do
      // NOT silently cascade years of character data.)
      await expect(
        db.delete(authSchema.user).where(eq(authSchema.user.id, userId)),
      ).rejects.toThrow();
    } finally {
      await cleanupUser(userId);
    }
  });
});
