import { randomUUID } from "node:crypto";
import { eq, inArray, sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PORTRAIT_IDS } from "@/game/config/foundations";
import {
  EXECUTION_CONFIRMATION,
  executeCutover,
  queryPlan,
  reportFromPlan,
} from "@/scripts/player-identity-cutover.mjs";
import { cleanupTestUser, createTestUser } from "./fixtures";

/**
 * Issue #221 account identity against real PostgreSQL: Player names through
 * the official Username plugin, mandatory email verification, the
 * verification-mail limits, the character-reservation gate, the committed
 * migration's shape, and the one-time cutover for pre-cutover accounts.
 *
 * Sign-up and resend go through `auth.api` with an explicit client IP header,
 * so the real Better Auth endpoint, hooks, plugins, and database hooks run.
 * Turnstile is verified in Better Auth's HTTP request handler, which
 * `auth.api` calls do not pass through; the browser journey proves it.
 * Verification mail is captured by the Vitest mail transport.
 */

const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));
vi.mock("next/headers", () => ({ headers: async () => requestHeaders.current }));

const DATABASE_URL = process.env.DATABASE_URL;
const suite = DATABASE_URL ? describe : describe.skip;
const PASSWORD = "sup3r-secret-password";
const HOST = "127.0.0.1:3000";

type ApiErrorShape = { status?: string; body?: { code?: string; retryAfterSeconds?: number } };

suite("Issue #221 verified Player identity (real PostgreSQL)", () => {
  let db: (typeof import("@/db"))["db"];
  let authSchema: typeof import("@/db/auth-schema");
  let rune: typeof import("@/db/rune-space");
  let auth: (typeof import("@/server/auth"))["auth"];
  let mail: typeof import("@/server/transactional-mail");
  let ownership: typeof import("@/server/ownership");
  let abuse: typeof import("@/server/account-abuse");
  let actions: typeof import("@/server/actions");
  const createdUsers: string[] = [];

  beforeAll(async () => {
    db = (await import("@/db")).db;
    authSchema = await import("@/db/auth-schema");
    rune = await import("@/db/rune-space");
    auth = (await import("@/server/auth")).auth;
    mail = await import("@/server/transactional-mail");
    ownership = await import("@/server/ownership");
    abuse = await import("@/server/account-abuse");
    actions = await import("@/server/actions");
  });

  afterEach(async () => {
    for (const userId of createdUsers.splice(0)) {
      await cleanupTestUser(db, authSchema, rune, userId);
    }
    mail.clearTestMailbox();
  });

  function clientIp(): string {
    const octet = () => Math.floor(Math.random() * 254) + 1;
    return `198.18.${octet()}.${octet()}`;
  }

  function headersFrom(ip: string): Headers {
    return new Headers({ host: HOST, "x-forwarded-for": ip });
  }

  function uniqueEmail(label: string): string {
    return `${label}-${randomUUID()}@example.com`;
  }

  async function signUp(input: {
    playerName?: string;
    username?: string;
    displayUsername?: string;
    email: string;
    ip?: string;
  }) {
    const body: Record<string, string> = {
      name: input.playerName ?? "ignored",
      email: input.email,
      password: PASSWORD,
    };
    if (input.playerName !== undefined) {
      body.username = input.playerName;
      body.displayUsername = input.playerName;
    }
    if (input.username !== undefined) body.username = input.username;
    if (input.displayUsername !== undefined) body.displayUsername = input.displayUsername;
    const result = await auth.api.signUpEmail({
      headers: headersFrom(input.ip ?? clientIp()),
      body: body as { name: string; email: string; password: string },
    });
    if (result.user?.id) {
      const exists = await db
        .select({ id: authSchema.user.id })
        .from(authSchema.user)
        .where(eq(authSchema.user.id, result.user.id));
      if (exists.length) createdUsers.push(result.user.id);
    }
    return result;
  }

  async function userByEmail(email: string) {
    const rows = await db.select().from(authSchema.user).where(eq(authSchema.user.email, email));
    return rows[0];
  }

  async function sessionHeadersFor(email: string): Promise<Headers> {
    const signIn = await auth.api.signInEmail({
      headers: new Headers({ host: HOST }),
      body: { email, password: PASSWORD },
      returnHeaders: true,
    });
    const setCookie = signIn.headers.get("set-cookie") ?? "";
    const cookie = setCookie
      .split(/,(?=\s*[^;,=\s]+=)/)
      .map((part) => part.split(";")[0]!.trim())
      .join("; ");
    return new Headers({ host: HOST, cookie });
  }

  function verificationLinkFor(email: string): URL {
    const message = [...mail.readTestMailbox()].reverse().find((entry) => entry.to === email);
    if (!message) throw new Error(`no verification email captured for ${email}`);
    const link = message.text.match(/https?:\/\/\S+\/verify-email\?\S+/)?.[0];
    if (!link) throw new Error("verification email has no link");
    return new URL(link);
  }

  async function expectApiError(promise: Promise<unknown>, code: string): Promise<ApiErrorShape> {
    const error = (await promise.then(
      () => {
        throw new Error(`expected ${code}`);
      },
      (caught: unknown) => caught,
    )) as ApiErrorShape;
    expect(error.body?.code).toBe(code);
    return error;
  }

  // ---------------------------------------------------------------------------
  // Committed migration shape
  // ---------------------------------------------------------------------------

  it("migration adds the Username-plugin columns with a unique key and the abuse ledger", async () => {
    const columns = await db.execute<{ column_name: string; is_nullable: string }>(sql`
      select column_name, is_nullable from information_schema.columns
      where table_name = 'user' and column_name in ('username', 'display_username')
      order by column_name
    `);
    expect(columns.rows).toEqual([
      { column_name: "display_username", is_nullable: "YES" },
      { column_name: "username", is_nullable: "YES" },
    ]);
    const unique = await db.execute<{ conname: string }>(sql`
      select conname from pg_constraint where conname = 'user_username_unique' and contype = 'u'
    `);
    expect(unique.rows).toHaveLength(1);
    const ledger = await db.execute<{ regclass: string | null }>(
      sql`select to_regclass('public.account_abuse_events')::text as regclass`,
    );
    expect(ledger.rows[0]?.regclass).toBe("account_abuse_events");
  });

  // ---------------------------------------------------------------------------
  // Sign-up, Player names, and verification
  // ---------------------------------------------------------------------------

  it("a new account starts unverified, has no session, and receives one verification email", async () => {
    const email = uniqueEmail("new");
    const result = await signUp({ playerName: "  Río   Grande ", email });
    expect(result.token).toBeNull();

    const user = await userByEmail(email);
    expect(user).toMatchObject({
      emailVerified: false,
      username: "río grande",
      displayUsername: "Río Grande",
      name: "Río Grande",
    });
    const sessions = await db
      .select()
      .from(authSchema.session)
      .where(eq(authSchema.session.userId, user!.id));
    expect(sessions).toHaveLength(0);

    const messages = mail.readTestMailbox().filter((entry) => entry.to === email);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      kind: "account-verification",
      subject: "Verify your RuneSpace account",
    });
    expect(verificationLinkFor(email).searchParams.get("token")).toBeTruthy();
  });

  it("canonicalizes the Player name from displayUsername so a crafted key cannot diverge", async () => {
    const email = uniqueEmail("crafted");
    await signUp({ email, username: "Admin", displayUsername: "Harmless Hauler" });
    expect(await userByEmail(email)).toMatchObject({
      username: "harmless hauler",
      displayUsername: "Harmless Hauler",
    });
  });

  it("refuses missing, invalid, and reserved Player names before creating anything", async () => {
    for (const attempt of [
      { email: uniqueEmail("missing") },
      { email: uniqueEmail("short"), playerName: "Al" },
      { email: uniqueEmail("punct"), playerName: "...." },
      { email: uniqueEmail("reserved"), playerName: "Mod Mike" },
      { email: uniqueEmail("crafted-display"), username: "harmless", displayUsername: "Admin" },
    ]) {
      await expectApiError(signUp(attempt), "INVALID_PLAYER_NAME");
      expect(await userByEmail(attempt.email)).toBeUndefined();
    }
  });

  it("Player names are unique case- and Unicode-insensitively, including under concurrency", async () => {
    await signUp({ playerName: "Nova Rae", email: uniqueEmail("first") });
    await expectApiError(
      signUp({ playerName: "NOVA  RAE", email: uniqueEmail("second") }),
      "USERNAME_IS_ALREADY_TAKEN",
    );
    await expectApiError(
      signUp({ playerName: "Ｎｏｖａ Ｒａｅ", email: uniqueEmail("fullwidth") }),
      "USERNAME_IS_ALREADY_TAKEN",
    );

    const racers = Array.from({ length: 4 }, (_, index) => uniqueEmail(`race-${index}`));
    const results = await Promise.allSettled(
      racers.map((email) => signUp({ playerName: "Concurrent Rae", email })),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const owners = await db
      .select({ id: authSchema.user.id })
      .from(authSchema.user)
      .where(eq(authSchema.user.username, "concurrent rae"));
    expect(owners).toHaveLength(1);
  });

  it("an unverified account cannot sign in, and signing in sends no email", async () => {
    const email = uniqueEmail("unverified");
    await signUp({ playerName: "Quiet Rae", email });
    mail.clearTestMailbox();
    await expectApiError(
      auth.api.signInEmail({
        headers: new Headers({ host: HOST }),
        body: { email, password: PASSWORD },
      }),
      "EMAIL_NOT_VERIFIED",
    );
    expect(mail.readTestMailbox()).toHaveLength(0);
  });

  it("the emailed link verifies the address, after which sign-in works", async () => {
    const email = uniqueEmail("verify");
    await signUp({ playerName: "Link Rae", email });
    const link = verificationLinkFor(email);
    await auth.api.verifyEmail({
      headers: new Headers({ host: HOST }),
      query: { token: link.searchParams.get("token")! },
    });
    expect((await userByEmail(email))?.emailVerified).toBe(true);
    const signedIn = await auth.api.signInEmail({
      headers: new Headers({ host: HOST }),
      body: { email, password: PASSWORD },
    });
    expect(signedIn.token).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // Abuse limits
  // ---------------------------------------------------------------------------

  it("explicit resend is limited to one per minute per address, registered or not", async () => {
    const email = uniqueEmail("resend");
    await signUp({ playerName: "Resend Rae", email });
    const ip = clientIp();

    await auth.api.sendVerificationEmail({ headers: headersFrom(ip), body: { email } });
    expect(mail.readTestMailbox().filter((entry) => entry.to === email)).toHaveLength(2);
    const throttled = await expectApiError(
      auth.api.sendVerificationEmail({ headers: headersFrom(ip), body: { email } }),
      "VERIFICATION_RESEND_THROTTLED",
    );
    expect(throttled.status).toBe("TOO_MANY_REQUESTS");
    expect(throttled.body?.retryAfterSeconds).toBeGreaterThan(0);
    expect(mail.readTestMailbox().filter((entry) => entry.to === email)).toHaveLength(2);

    // An unregistered address is limited identically, so the limit reveals nothing.
    const stranger = uniqueEmail("stranger");
    await auth.api.sendVerificationEmail({ headers: headersFrom(ip), body: { email: stranger } });
    await expectApiError(
      auth.api.sendVerificationEmail({ headers: headersFrom(ip), body: { email: stranger } }),
      "VERIFICATION_RESEND_THROTTLED",
    );
    expect(mail.readTestMailbox().filter((entry) => entry.to === stranger)).toHaveLength(0);
  });

  it("admits five signup attempts per IP per 15 minutes, then throttles that IP only", async () => {
    const ip = clientIp();
    for (let index = 0; index < 5; index += 1) {
      await signUp({ playerName: `Burst Rae ${index}`, email: uniqueEmail(`burst-${index}`), ip });
    }
    const blockedEmail = uniqueEmail("burst-6");
    await expectApiError(
      signUp({ playerName: "Burst Rae 6", email: blockedEmail, ip }),
      "SIGNUP_THROTTLED",
    );
    expect(await userByEmail(blockedEmail)).toBeUndefined();
    await signUp({ playerName: "Other Network", email: uniqueEmail("other"), ip: clientIp() });
  });

  it("refuses signup and resend while an IP is at its hourly verification-mail cap", async () => {
    const ip = clientIp();
    const now = new Date();
    await db.insert(rune.accountAbuseEvents).values(
      Array.from({ length: 20 }, (_, index) => ({
        kind: "verification_dispatch",
        ipBucket: ip,
        emailKey: `cap-${index}@example.com`,
        createdAt: new Date(now.getTime() - index * 1_000),
      })),
    );
    expect(await abuse.admitSignupAttempt(ip)).toMatchObject({
      admitted: false,
      reason: "ip-mail-cap",
    });
    expect(await abuse.admitVerificationResend(uniqueEmail("cap"), ip)).toMatchObject({
      admitted: false,
      reason: "ip-mail-cap",
    });
    await db.delete(rune.accountAbuseEvents).where(eq(rune.accountAbuseEvents.ipBucket, ip));
  });

  it("opens the dispatch circuit at abnormal global velocity", async () => {
    // A far-future instant keeps these rows invisible to every real-time decision.
    const future = new Date("2099-01-01T00:00:00.000Z");
    const ip = clientIp();
    await db.insert(rune.accountAbuseEvents).values(
      Array.from({ length: 100 }, (_, index) => ({
        kind: "verification_dispatch",
        ipBucket: `circuit-${index}`,
        emailKey: `circuit-${index}@example.com`,
        createdAt: new Date(future.getTime() - index * 1_000),
      })),
    );
    try {
      expect(await abuse.reserveVerificationDispatch("next@example.com", ip, future)).toMatchObject(
        {
          admitted: false,
          reason: "verification-mail-paused",
        },
      );
      expect(await abuse.admitSignupAttempt(ip, future)).toMatchObject({
        admitted: false,
        reason: "verification-mail-paused",
      });
    } finally {
      await db
        .delete(rune.accountAbuseEvents)
        .where(sql`${rune.accountAbuseEvents.createdAt} > now() + interval '1 year'`);
    }
  });

  // ---------------------------------------------------------------------------
  // Immutable Player names
  // ---------------------------------------------------------------------------

  it("ordinary users cannot change their Player name through the auth API", async () => {
    const userId = await createTestUser(db, authSchema, "Fixed Name", uniqueEmail("fixed"));
    createdUsers.push(userId);
    await db.insert(authSchema.account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: await (await import("better-auth/crypto")).hashPassword(PASSWORD),
    });
    const [{ email }] = (await db
      .select({ email: authSchema.user.email })
      .from(authSchema.user)
      .where(eq(authSchema.user.id, userId))) as [{ email: string }];
    const headers = await sessionHeadersFor(email);

    for (const body of [
      { username: "Renamed" },
      { displayUsername: "Renamed" },
      { username: "Renamed", displayUsername: "Renamed" },
    ]) {
      await expectApiError(
        auth.api.updateUser({ headers, body: body as Record<string, string> }),
        "PLAYER_NAME_IMMUTABLE",
      );
    }
    const [row] = await db.select().from(authSchema.user).where(eq(authSchema.user.id, userId));
    expect(row).toMatchObject({ displayUsername: "Fixed Name", username: `fixture:${userId}` });
  });

  // ---------------------------------------------------------------------------
  // Character reservation gate
  // ---------------------------------------------------------------------------

  it("character reservation requires a verified email, even through a forged server action", async () => {
    const userId = await createTestUser(db, authSchema, "Gate Rae", uniqueEmail("gate"));
    createdUsers.push(userId);
    await db.insert(authSchema.account).values({
      id: randomUUID(),
      accountId: userId,
      providerId: "credential",
      userId,
      password: await (await import("better-auth/crypto")).hashPassword(PASSWORD),
    });
    const [{ email }] = (await db
      .select({ email: authSchema.user.email })
      .from(authSchema.user)
      .where(eq(authSchema.user.id, userId))) as [{ email: string }];
    // A session that outlives verification — e.g. one issued before cutover.
    requestHeaders.current = await sessionHeadersFor(email);
    await db
      .update(authSchema.user)
      .set({ emailVerified: false })
      .where(eq(authSchema.user.id, userId));

    await expect(ownership.requireVerifiedUser(requestHeaders.current)).rejects.toMatchObject({
      status: 403,
    });
    const form = new FormData();
    form.set("name", `Gate Hero ${randomUUID().slice(0, 6)}`);
    form.set("portraitId", PORTRAIT_IDS.evaSalvageWelder);
    expect(await actions.createCharacterAction(form)).toEqual({
      error: ownership.EMAIL_VERIFICATION_REQUIRED_MESSAGE,
    });
    const accounts = await db
      .select({ id: rune.playerAccounts.id })
      .from(rune.playerAccounts)
      .where(eq(rune.playerAccounts.userId, userId));
    const created = accounts.length
      ? await db
          .select()
          .from(rune.characters)
          .where(
            inArray(
              rune.characters.playerAccountId,
              accounts.map((account) => account.id),
            ),
          )
      : [];
    expect(created).toHaveLength(0);

    // Once verified, the same action reserves the character (and redirects to Play).
    await db
      .update(authSchema.user)
      .set({ emailVerified: true })
      .where(eq(authSchema.user.id, userId));
    await expect(actions.createCharacterAction(form)).rejects.toThrow(/NEXT_REDIRECT/);
    const account = await ownership.requirePlayerAccount(userId);
    const reserved = await db
      .select()
      .from(rune.characters)
      .where(eq(rune.characters.playerAccountId, account.id));
    expect(reserved).toHaveLength(1);
  });

  // ---------------------------------------------------------------------------
  // One-time cutover for pre-cutover accounts
  // ---------------------------------------------------------------------------

  describe("pre-cutover account cutover", () => {
    const { Client } = pg;
    let client: InstanceType<typeof Client>;

    beforeAll(async () => {
      client = new Client({ connectionString: DATABASE_URL });
      await client.connect();
    });

    afterAll(async () => {
      await client.end();
    });

    async function legacyUser(name: string, emailVerified = false): Promise<string> {
      const id = randomUUID();
      await db.insert(authSchema.user).values({
        id,
        name,
        email: `${id}@example.com`,
        emailVerified,
        createdAt: new Date("2026-08-01T00:00:00.000Z"),
        updatedAt: new Date("2026-08-01T00:00:00.000Z"),
      });
      createdUsers.push(id);
      return id;
    }

    it("plans every account without a Player name and surfaces problems instead of inventing names", async () => {
      const valid = await legacyUser("Brandon Werner");
      const alreadyVerified = await legacyUser("Rae_42", true);
      const reserved = await legacyUser("Admin");
      const twinA = await legacyUser("Twin Hauler");
      const twinB = await legacyUser("twin  hauler");
      const takenBy = await createTestUser(db, authSchema, "Taken Name", uniqueEmail("taken"));
      createdUsers.push(takenBy);
      await db
        .update(authSchema.user)
        .set({ username: "claimed legacy" })
        .where(eq(authSchema.user.id, takenBy));
      const taken = await legacyUser("Claimed Legacy");

      const plan = await queryPlan(client);
      const mine = new Set([valid, alreadyVerified, reserved, twinA, twinB, taken]);
      expect(plan.accounts.filter((account) => mine.has(account.userId))).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            userId: valid,
            playerName: "Brandon Werner",
            playerNameKey: "brandon werner",
            wasEmailVerified: false,
          }),
          expect.objectContaining({ userId: alreadyVerified, wasEmailVerified: true }),
        ]),
      );
      const problems = Object.fromEntries(
        plan.problems
          .filter((problem) => mine.has(problem.userId))
          .map((problem) => [problem.userId, problem.reason]),
      );
      expect(problems).toEqual({
        [reserved]: "invalid",
        [twinA]: "cohort-collision",
        [twinB]: "cohort-collision",
        [taken]: "taken",
      });

      const report = reportFromPlan(plan);
      await expect(executeCutover(client, report, EXECUTION_CONFIRMATION)).rejects.toThrow(
        /lists problems/,
      );
      const untouched = await db
        .select({ username: authSchema.user.username, verified: authSchema.user.emailVerified })
        .from(authSchema.user)
        .where(eq(authSchema.user.id, valid));
      expect(untouched[0]).toEqual({ username: null, verified: false });
    });

    it("executes with explicit operator resolutions, grandfathers verification, and sends no email", async () => {
      const valid = await legacyUser("Brandon Werner");
      const reserved = await legacyUser("Admin");
      const twinA = await legacyUser("Twin Hauler");
      const twinB = await legacyUser("twin  hauler");
      const overrides = { [reserved]: "Admiral Rae", [twinB]: "Twin Hauler Two" };

      const report = reportFromPlan(await queryPlan(client, overrides), overrides);
      expect(report.problems).toEqual([]);
      await expect(executeCutover(client, report, "WRONG-TOKEN", overrides)).rejects.toThrow();
      await expect(executeCutover(client, report, EXECUTION_CONFIRMATION, {})).rejects.toThrow(
        /--name resolutions differ/,
      );

      const result = await executeCutover(client, report, EXECUTION_CONFIRMATION, overrides);
      expect(result.verification.afterCommit.passed).toBe(true);

      const rows = await db
        .select({
          id: authSchema.user.id,
          username: authSchema.user.username,
          displayUsername: authSchema.user.displayUsername,
          emailVerified: authSchema.user.emailVerified,
          name: authSchema.user.name,
        })
        .from(authSchema.user)
        .where(inArray(authSchema.user.id, [valid, reserved, twinA, twinB]));
      expect(Object.fromEntries(rows.map((row) => [row.id, row]))).toEqual({
        [valid]: {
          id: valid,
          username: "brandon werner",
          displayUsername: "Brandon Werner",
          emailVerified: true,
          name: "Brandon Werner",
        },
        [reserved]: {
          id: reserved,
          username: "admiral rae",
          displayUsername: "Admiral Rae",
          emailVerified: true,
          name: "Admin",
        },
        [twinA]: {
          id: twinA,
          username: "twin hauler",
          displayUsername: "Twin Hauler",
          emailVerified: true,
          name: "Twin Hauler",
        },
        [twinB]: {
          id: twinB,
          username: "twin hauler two",
          displayUsername: "Twin Hauler Two",
          emailVerified: true,
          name: "twin  hauler",
        },
      });
      expect(mail.readTestMailbox()).toHaveLength(0);

      // Idempotent: the migrated accounts leave the cohort.
      const again = await queryPlan(client);
      const ids = new Set([valid, reserved, twinA, twinB]);
      expect(again.accounts.some((account) => ids.has(account.userId))).toBe(false);
      expect(again.problems.some((problem) => ids.has(problem.userId))).toBe(false);
    });

    it("refuses to execute when the database changed after the reviewed dry run", async () => {
      await legacyUser("Steady Hauler");
      const report = reportFromPlan(await queryPlan(client));
      await legacyUser("Late Arrival");
      await expect(executeCutover(client, report, EXECUTION_CONFIRMATION)).rejects.toThrow(
        /no longer matches/,
      );
    });
  });
});
