import { and, count, eq, sql } from "drizzle-orm";
import { parseSetCookieHeader } from "better-auth/cookies";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { ACTION_IDS, PORTRAIT_IDS } from "@/game/config/foundations";
import {
  cleanupTestUser,
  createCharacterForUser,
  createTestUser,
  grantFixtureEarlyAccess,
} from "./fixtures";

/** The locked launch target: 2026-10-27 09:00 America/Los_Angeles. */
const SOFT_ALPHA_LAUNCH_TARGET_ISO = "2026-10-27T16:00:00.000Z";

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;

/**
 * Issue #223 — the authoritative gameplay-access gate, account Early Access,
 * and the explicit public-gameplay switch, against real PostgreSQL.
 *
 * This is the ONLY integration file that changes the global
 * `runespace_access_state` switch. Vitest runs one file's tests sequentially,
 * and every other suite's fixture accounts carry fixture Early Access, so no
 * other suite depends on the switch. It is restored to Closed after each test.
 */
suite("issue #223 gameplay access (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let ownership: typeof import("@/server/ownership");
  let characters: typeof import("@/server/characters");
  let access: typeof import("@/server/gameplay-access");
  let play: typeof import("@/server/play");
  let mining: typeof import("@/server/mining-commands");
  let trade: typeof import("@/server/trade");
  let powerAnnex: typeof import("@/server/power-annex");
  let population: typeof import("@/server/location-population");
  let profile: typeof import("@/server/character-profile");
  let news: typeof import("@/server/account-news");
  let seams: typeof import("@/server/admin-command-seams");
  let commands: typeof import("@/server/admin-commands");
  let audit: typeof import("@/server/admin-audit");
  let adminSession: typeof import("@/tests/e2e/admin-session");
  const createdUsers: string[] = [];
  const token = () => Math.random().toString(36).slice(2, 8);
  const ADMIN = "00000000-0000-4000-8000-0000000223a1";

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    ownership = await import("@/server/ownership");
    characters = await import("@/server/characters");
    access = await import("@/server/gameplay-access");
    play = await import("@/server/play");
    mining = await import("@/server/mining-commands");
    trade = await import("@/server/trade");
    powerAnnex = await import("@/server/power-annex");
    population = await import("@/server/location-population");
    profile = await import("@/server/character-profile");
    news = await import("@/server/account-news");
    seams = await import("@/server/admin-command-seams");
    commands = await import("@/server/admin-commands");
    audit = await import("@/server/admin-audit");
    adminSession = await import("@/tests/e2e/admin-session");
  });

  async function setPublicGameplayOpen(open: boolean) {
    await db
      .update(rune.runespaceAccessState)
      .set({ publicGameplayOpen: open })
      .where(eq(rune.runespaceAccessState.id, 1));
  }

  afterEach(async () => {
    await setPublicGameplayOpen(false);
    for (const userId of createdUsers.splice(0))
      await cleanupTestUser(db, authSchema, rune, userId);
  });

  afterAll(async () => {
    await setPublicGameplayOpen(false);
  });

  /** One account with one character; Early Access only when asked for. */
  async function makePlayer(options: { verified?: boolean; earlyAccess?: boolean } = {}) {
    const userId = await createTestUser(db, authSchema, `Access ${token()}`, undefined, {
      emailVerified: options.verified ?? true,
    });
    createdUsers.push(userId);
    const character = await createCharacterForUser(
      db,
      rune,
      ownership,
      characters,
      userId,
      `Access ${token()}`,
      undefined,
      { seedLegacyStarterCutter: false, gameplayAccess: options.earlyAccess ?? false },
    );
    return { userId, playerAccountId: character.playerAccountId, character };
  }

  async function auditCount(where: ReturnType<typeof eq>) {
    const [row] = await db.select({ n: count() }).from(rune.operatorAuditLogs).where(where);
    return row?.n ?? 0;
  }

  it("the migration seeds the singleton Closed with the locked Soft Alpha target", async () => {
    const rows = await db.select().from(rune.runespaceAccessState);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(1);
    expect(rows[0]!.publicGameplayOpen).toBe(false);
    expect(rows[0]!.softAlphaLaunchTargetAt.toISOString()).toBe(SOFT_ALPHA_LAUNCH_TARGET_ISO);
    // A second row can never exist.
    await expect(
      db.insert(rune.runespaceAccessState).values({
        id: 2,
        softAlphaLaunchTargetAt: new Date(SOFT_ALPHA_LAUNCH_TARGET_ISO),
      }),
    ).rejects.toThrow();
  });

  it.each([
    { verified: false, earlyAccess: false, open: false, allowed: false },
    { verified: false, earlyAccess: true, open: false, allowed: false },
    { verified: false, earlyAccess: false, open: true, allowed: false },
    { verified: true, earlyAccess: false, open: false, allowed: false },
    { verified: true, earlyAccess: true, open: false, allowed: true },
    { verified: true, earlyAccess: false, open: true, allowed: true },
    { verified: true, earlyAccess: true, open: true, allowed: true },
  ])(
    "authoritative matrix: verified=$verified earlyAccess=$earlyAccess open=$open → allowed=$allowed",
    async ({ verified, earlyAccess, open, allowed }) => {
      const player = await makePlayer({ verified, earlyAccess });
      await setPublicGameplayOpen(open);
      const loaded = await access.loadAccountGameplayAccess(db, player.userId);
      expect(loaded.decision.allowed).toBe(allowed);
      if (allowed) {
        await expect(
          play.getPlayGameplayState(player.userId, player.character.id),
        ).resolves.toBeDefined();
      } else {
        await expect(
          play.getPlayGameplayState(player.userId, player.character.id),
        ).rejects.toMatchObject({ name: "GameplayAccessError", status: 403 });
      }
    },
  );

  it("refuses a verified closed account at every seam before locking or reconciling", async () => {
    const player = await makePlayer();
    // A due active action proves refusal happens before lazy reconciliation:
    // if any seam reconciled, the cursor would advance.
    const startedAt = new Date(Date.now() - 60 * 60 * 1000);
    await db.insert(rune.activeActions).values({
      characterId: player.character.id,
      actionId: ACTION_IDS.ferriteShaleMining,
      startedAt,
      resolvedThroughAt: startedAt,
    });
    const refused = { name: "GameplayAccessError", status: 403 };
    // Initial/refresh Play state (lock + reconcile boundary).
    await expect(
      play.getPlayGameplayState(player.userId, player.character.id),
    ).rejects.toMatchObject(refused);
    // A gameplay mutation through the same boundary.
    await expect(mining.startMining(player.userId, player.character.id)).rejects.toMatchObject(
      refused,
    );
    // Lock-only instantaneous interactions.
    await expect(
      trade.tradeWithMerchant(player.userId, player.character.id, {} as never),
    ).rejects.toMatchObject(refused);
    await expect(
      powerAnnex.claimPowerCells(player.userId, player.character.id),
    ).rejects.toMatchObject(refused);
    await expect(
      play.acknowledgeScavengeReveal(player.userId, player.character.id, "any"),
    ).rejects.toMatchObject(refused);
    // Unlocked gameplay reads (Play page, population, profile).
    await expect(
      access.requirePlayableOwnedCharacter(player.userId, player.character.id),
    ).rejects.toMatchObject(refused);
    await expect(
      population.getLocationPopulation(player.userId, player.character.id),
    ).rejects.toMatchObject(refused);
    await expect(
      profile.getCharacterProfile(player.userId, player.character.id, "Anyone"),
    ).rejects.toMatchObject(refused);

    const [action] = await db
      .select()
      .from(rune.activeActions)
      .where(eq(rune.activeActions.characterId, player.character.id));
    expect(action?.resolvedThroughAt.toISOString()).toBe(startedAt.toISOString());
    const provisioning = await db
      .select()
      .from(rune.characterStarterProvisioning)
      .where(eq(rune.characterStarterProvisioning.characterId, player.character.id));
    expect(provisioning).toHaveLength(0);
  });

  it("keeps reservation, portrait choice, and account news available to a verified closed account", async () => {
    const player = await makePlayer();
    const account = await ownership.ensurePlayerAccount(player.userId);
    const second = await characters.createCharacter(
      account.id,
      `Reserve ${token()}`,
      PORTRAIT_IDS.evaSalvageWelder,
    );
    expect(second.playerAccountId).toBe(account.id);
    const changed = await characters.changeCharacterPortrait(
      player.userId,
      second.id,
      PORTRAIT_IDS.gramma,
    );
    expect(changed.portraitId).toBe(PORTRAIT_IDS.gramma);
    await expect(news.acknowledgeNews(player.userId)).resolves.toBeUndefined();
    // The reservation redirect decision comes from the same authoritative load.
    const loaded = await access.loadAccountGameplayAccess(db, player.userId);
    expect(loaded.decision).toEqual({ allowed: false, reason: "gameplay_closed" });
  });

  it("an unverified account is refused even with Early Access and public gameplay open", async () => {
    const player = await makePlayer({ verified: false, earlyAccess: true });
    await setPublicGameplayOpen(true);
    const loaded = await access.loadAccountGameplayAccess(db, player.userId);
    expect(loaded.decision).toEqual({ allowed: false, reason: "email_unverified" });
  });

  it("Early Access granted from one character's inspector admits every character on the account", async () => {
    const player = await makePlayer();
    const account = await ownership.ensurePlayerAccount(player.userId);
    const sibling = await characters.createCharacter(
      account.id,
      `Sibling ${token()}`,
      PORTRAIT_IDS.evaSalvageWelder,
    );
    await expect(play.getPlayGameplayState(player.userId, sibling.id)).rejects.toMatchObject({
      status: 403,
    });

    const result = await seams.grantEarlyAccessAsAdmin(ADMIN, player.playerAccountId);
    expect(result.changed).toBe(true);
    await expect(
      play.getPlayGameplayState(player.userId, player.character.id),
    ).resolves.toBeDefined();
    await expect(play.getPlayGameplayState(player.userId, sibling.id)).resolves.toBeDefined();
  });

  it("grant/revoke set and clear both paired fields, audit atomically, and never duplicate history", async () => {
    const player = await makePlayer();
    const accountAudit = and(
      eq(rune.operatorAuditLogs.targetKind, "player_account"),
      eq(rune.operatorAuditLogs.playerAccountId, player.playerAccountId),
    )!;
    const grantedAt = new Date("2026-10-01T12:00:00.000Z");

    const granted = await seams.grantEarlyAccessAsAdmin(ADMIN, player.playerAccountId, grantedAt);
    expect(granted.changed).toBe(true);
    expect(granted.view.earlyAccess).toEqual({ grantedAt, grantedByAdminUserId: ADMIN });
    const [row] = await db
      .select()
      .from(rune.playerAccounts)
      .where(eq(rune.playerAccounts.id, player.playerAccountId));
    expect(row?.earlyAccessGrantedAt?.toISOString()).toBe(grantedAt.toISOString());
    expect(row?.earlyAccessGrantedByAdminUserId).toBe(ADMIN);
    expect(await auditCount(accountAudit)).toBe(1);

    const repeated = await seams.grantEarlyAccessAsAdmin(ADMIN, player.playerAccountId);
    expect(repeated.changed).toBe(false);
    expect(repeated.view.earlyAccess?.grantedAt.toISOString()).toBe(grantedAt.toISOString());
    expect(await auditCount(accountAudit)).toBe(1);

    const revoked = await seams.revokeEarlyAccessAsAdmin(ADMIN, player.playerAccountId);
    expect(revoked.changed).toBe(true);
    expect(revoked.view.earlyAccess).toBeNull();
    const [cleared] = await db
      .select()
      .from(rune.playerAccounts)
      .where(eq(rune.playerAccounts.id, player.playerAccountId));
    expect(cleared?.earlyAccessGrantedAt).toBeNull();
    expect(cleared?.earlyAccessGrantedByAdminUserId).toBeNull();
    expect(await auditCount(accountAudit)).toBe(2);

    const revokedAgain = await seams.revokeEarlyAccessAsAdmin(ADMIN, player.playerAccountId);
    expect(revokedAgain.changed).toBe(false);
    expect(await auditCount(accountAudit)).toBe(2);

    const history = await db.transaction((tx) =>
      audit.loadPlayerAccountAuditLog(tx, player.playerAccountId),
    );
    expect(history.map((entry) => entry.operation)).toEqual([
      "revoke_early_access",
      "grant_early_access",
    ]);
    expect(history.every((entry) => entry.adminUserId === ADMIN)).toBe(true);
    expect(history.every((entry) => entry.characterId === null)).toBe(true);
    expect(revoked.view.audit).toHaveLength(2);
  });

  it("revoking Early Access refuses the account's next gameplay request", async () => {
    const player = await makePlayer({ earlyAccess: true });
    await expect(
      play.getPlayGameplayState(player.userId, player.character.id),
    ).resolves.toBeDefined();
    await seams.revokeEarlyAccessAsAdmin(ADMIN, player.playerAccountId);
    await expect(
      play.getPlayGameplayState(player.userId, player.character.id),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("open/close flip the switch with one system audit row each and are reversible", async () => {
    const systemAudit = eq(rune.operatorAuditLogs.targetKind, "system");
    const ordinary = await makePlayer();
    const early = await makePlayer({ earlyAccess: true });
    const before = await auditCount(systemAudit);
    const now = new Date("2026-10-27T16:05:00.000Z");

    // Close while already closed: no change, no history.
    const noop = await seams.setPublicGameplayOpenAsAdmin(ADMIN, false, now);
    expect(noop.changed).toBe(false);
    expect(await auditCount(systemAudit)).toBe(before);

    const opened = await seams.setPublicGameplayOpenAsAdmin(ADMIN, true, now);
    expect(opened.changed).toBe(true);
    expect(opened.view.publicGameplayOpen).toBe(true);
    expect(opened.view.updatedByAdminUserId).toBe(ADMIN);
    // The target is presentation-only and never written by the switch.
    expect(opened.view.launchTargetAt.toISOString()).toBe(SOFT_ALPHA_LAUNCH_TARGET_ISO);
    expect(await auditCount(systemAudit)).toBe(before + 1);
    await expect(
      play.getPlayGameplayState(ordinary.userId, ordinary.character.id),
    ).resolves.toBeDefined();

    const openedAgain = await seams.setPublicGameplayOpenAsAdmin(ADMIN, true, now);
    expect(openedAgain.changed).toBe(false);
    expect(await auditCount(systemAudit)).toBe(before + 1);

    const closed = await seams.setPublicGameplayOpenAsAdmin(ADMIN, false, now);
    expect(closed.changed).toBe(true);
    expect(await auditCount(systemAudit)).toBe(before + 2);
    // Closing blocks the ordinary account's next request; Early Access still plays.
    await expect(
      play.getPlayGameplayState(ordinary.userId, ordinary.character.id),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      play.getPlayGameplayState(early.userId, early.character.id),
    ).resolves.toBeDefined();

    const [latest] = await db.transaction((tx) => audit.loadSystemAuditLog(tx, 2));
    expect(latest?.operation).toBe("close_public_gameplay");
    expect(latest?.characterId).toBeNull();
    expect(latest?.playerAccountId).toBeNull();
    expect(latest?.details).toEqual({ publicGameplayOpen: { from: true, to: false } });
  });

  it("the database rejects partial Early Access state and malformed audit targets", async () => {
    const player = await makePlayer();
    await expect(
      db
        .update(rune.playerAccounts)
        .set({ earlyAccessGrantedAt: new Date() })
        .where(eq(rune.playerAccounts.id, player.playerAccountId)),
    ).rejects.toThrow();
    await expect(
      db
        .update(rune.playerAccounts)
        .set({ earlyAccessGrantedByAdminUserId: ADMIN })
        .where(eq(rune.playerAccounts.id, player.playerAccountId)),
    ).rejects.toThrow();
    const base = { adminUserId: ADMIN, operation: "grant_early_access", details: {} };
    await expect(
      db.insert(rune.operatorAuditLogs).values({
        ...base,
        targetKind: "player_account",
        characterId: player.character.id,
        playerAccountId: player.playerAccountId,
      }),
    ).rejects.toThrow();
    await expect(
      db
        .insert(rune.operatorAuditLogs)
        .values({ ...base, targetKind: "system", playerAccountId: player.playerAccountId }),
    ).rejects.toThrow();
    await expect(
      db.insert(rune.operatorAuditLogs).values({ ...base, targetKind: "character" }),
    ).rejects.toThrow();
    await expect(
      db.insert(rune.operatorAuditLogs).values({ ...base, targetKind: "account" }),
    ).rejects.toThrow();
  });

  it("a failed audit write rolls the Early Access and public-gameplay mutations back", async () => {
    const player = await makePlayer();
    const failing = "force-audit-failure-223";
    await db.execute(
      sql.raw(`create or replace function issue_223_fail_audit() returns trigger language plpgsql as $fail$
       begin
         if new.admin_user_id = '${failing}' then raise exception 'forced audit failure'; end if;
         return new;
       end $fail$`),
    );
    await db.execute(
      sql.raw(`create trigger issue_223_fail_audit before insert on operator_audit_logs
       for each row execute function issue_223_fail_audit()`),
    );
    try {
      await expect(
        seams.grantEarlyAccessAsAdmin(failing, player.playerAccountId),
      ).rejects.toThrow();
      const [row] = await db
        .select()
        .from(rune.playerAccounts)
        .where(eq(rune.playerAccounts.id, player.playerAccountId));
      expect(row?.earlyAccessGrantedAt).toBeNull();
      expect(row?.earlyAccessGrantedByAdminUserId).toBeNull();

      await expect(seams.setPublicGameplayOpenAsAdmin(failing, true)).rejects.toThrow();
      const [state] = await db.select().from(rune.runespaceAccessState);
      expect(state?.publicGameplayOpen).toBe(false);
    } finally {
      await db.execute(
        sql.raw(`drop trigger if exists issue_223_fail_audit on operator_audit_logs`),
      );
      await db.execute(sql.raw(`drop function if exists issue_223_fail_audit()`));
    }
  });

  it("an ordinary or unauthenticated caller cannot grant, revoke, open, or close", async () => {
    const player = await makePlayer();
    const nonAdmin = await adminSession.seedNonAdminUser();
    const { auth } = await import("@/server/auth");
    const signIn = await auth.api.signInEmail({
      headers: new Headers({ host: "127.0.0.1:3000" }),
      body: { email: nonAdmin.email, password: nonAdmin.password },
      returnHeaders: true,
    });
    const sessionCookie = [
      ...parseSetCookieHeader(signIn.headers.get("set-cookie") ?? "").entries(),
    ].find(([name, value]) => name.endsWith("session_token") && value.value);
    expect(sessionCookie).toBeDefined();
    const cookie = `${sessionCookie![0]}=${sessionCookie![1].value}`;
    const nonAdminHeaders = new Headers({ host: "127.0.0.1:3000", cookie });
    const anonymous = new Headers({ host: "127.0.0.1:3000" });
    const accountAudit = eq(rune.operatorAuditLogs.playerAccountId, player.playerAccountId);
    const systemAudit = eq(rune.operatorAuditLogs.targetKind, "system");
    const systemBefore = await auditCount(systemAudit);

    for (const headers of [nonAdminHeaders, anonymous]) {
      await expect(
        commands.grantEarlyAccess(headers, player.playerAccountId),
      ).rejects.toMatchObject({ status: headers === anonymous ? 401 : 403 });
      await expect(
        commands.revokeEarlyAccess(headers, player.playerAccountId),
      ).rejects.toMatchObject({ status: headers === anonymous ? 401 : 403 });
      await expect(commands.openPublicGameplay(headers)).rejects.toMatchObject({
        status: headers === anonymous ? 401 : 403,
      });
      await expect(commands.closePublicGameplay(headers)).rejects.toMatchObject({
        status: headers === anonymous ? 401 : 403,
      });
    }
    const loaded = await access.loadAccountGameplayAccess(db, player.userId);
    expect(loaded.earlyAccessGrantedAt).toBeNull();
    expect(loaded.publicGameplayOpen).toBe(false);
    expect(await auditCount(accountAudit)).toBe(0);
    expect(await auditCount(systemAudit)).toBe(systemBefore);
  });

  it("admin allowlist membership does not grant gameplay", async () => {
    const admin = await adminSession.seedAdminOperator();
    const account = await ownership.ensurePlayerAccount(admin.adminUserId);
    // The fixed operator account is shared across suites: start it without a
    // grant so the decision below depends only on Early Access, never on the
    // operator's allowlisted identity.
    const clearGrant = () =>
      db
        .update(rune.playerAccounts)
        .set({ earlyAccessGrantedAt: null, earlyAccessGrantedByAdminUserId: null })
        .where(eq(rune.playerAccounts.id, account.id));
    await clearGrant();
    await expect(access.requireGameplayAccess(db, admin.adminUserId)).rejects.toMatchObject({
      name: "GameplayAccessError",
      status: 403,
    });
    await grantFixtureEarlyAccess(db, rune, account.id);
    await expect(access.requireGameplayAccess(db, admin.adminUserId)).resolves.toBe(account.id);
    await clearGrant();
  });
});
