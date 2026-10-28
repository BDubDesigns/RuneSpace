import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import pg from "pg";
import { assertDisposableE2EDatabase } from "./test-database";

/**
 * Issue #425 — the first-party aggregate referral counter on the real
 * production server, in a real browser.
 *
 * Counting is production-host only. The disposable E2E runtime additionally
 * counts the exact host `localhost` (`middleware.ts`; previews and production
 * can never satisfy that gate), and no other spec uses that host, so this spec
 * owns the `referral_daily_counts` table for its run. `localhost` is a
 * potentially trustworthy origin, so Chromium sends the Fetch Metadata headers
 * the counter relies on, exactly as it does over HTTPS in production.
 * `127.0.0.1` (the suite's normal host) is the "another host is not counted"
 * control.
 */
test.describe.configure({ mode: "serial" });

const PORT = new URL(process.env.BASE_URL ?? "http://127.0.0.1:3000").port;
const ORIGIN = `http://localhost:${PORT}`;
const CHROME_UA =
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

type Row = {
  source_group: string;
  utm_source: string;
  utm_campaign: string;
  route_category: string;
  visits: number;
};

let db: pg.Client;
let browser: Browser;

test.beforeAll(async ({ browser: sharedBrowser }) => {
  assertDisposableE2EDatabase();
  db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  browser = sharedBrowser;
});

test.afterAll(async () => {
  await db?.end();
});

test.beforeEach(async () => {
  await db.query("TRUNCATE referral_daily_counts");
});

async function rows(): Promise<Row[]> {
  const result = await db.query<Row>(
    `select source_group, utm_source, utm_campaign, route_category, visits
       from referral_daily_counts order by route_category, source_group, utm_source`,
  );
  return result.rows;
}

async function total(): Promise<number> {
  return (await rows()).reduce((sum, row) => sum + row.visits, 0);
}

function visitor(options: Parameters<Browser["newContext"]>[0] = {}): Promise<BrowserContext> {
  return browser.newContext({ userAgent: CHROME_UA, ...options });
}

test("counts each public document load once, by source, and not client-side navigation", async () => {
  const context = await visitor();
  const page = await context.newPage();

  await page.goto(`${ORIGIN}/wiki?utm_source=Reddit&utm_campaign=e2e-launch&secret=nope`, {
    referer: "https://old.reddit.com/r/runespace/comments/abc?token=zzz",
  });
  await expect.poll(total).toBe(1);

  // An in-app link click is a client-side (RSC) navigation, plus prefetches of
  // visible links: none of it is a document load.
  await page.getByRole("link", { name: "Getting Started" }).first().click();
  await expect(page).toHaveURL(/\/wiki\/getting-started/);
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(300);
  expect(await total()).toBe(1);

  expect(await rows()).toEqual([
    {
      source_group: "reddit",
      utm_source: "reddit",
      utm_campaign: "e2e-launch",
      route_category: "wiki",
      visits: 1,
    },
  ]);

  // A reload is a new page load, and is counted as one (counts are loads, not people).
  await page.reload();
  await expect.poll(total).toBe(2);
  await context.close();
});

test("counts the statically generated public pages and nothing from the game or API", async () => {
  const context = await visitor();
  const page = await context.newPage();
  for (const path of ["/", "/updates", "/wiki/safety-and-privacy", "/high-scores", "/register"]) {
    const before = await total();
    await page.goto(`${ORIGIN}${path}`);
    await expect.poll(total, { message: path }).toBe(before + 1);
  }
  expect((await rows()).map((row) => row.route_category).sort()).toEqual([
    "auth",
    "high-scores",
    "landing",
    "updates",
    "wiki",
  ]);
  expect((await rows()).every((row) => row.source_group === "direct_unknown")).toBe(true);

  const before = await total();
  await page.request.get(`${ORIGIN}/api/build-info`);
  await page.goto(`${ORIGIN}/no-such-page`);
  await page.waitForTimeout(500);
  expect(await total()).toBe(before);
  await context.close();
});

test("does not count another host, a privacy signal, or a crawler", async () => {
  const local = await visitor();
  const localPage = await local.newPage();
  await localPage.goto(`http://127.0.0.1:${PORT}/wiki`);

  const gpc = await visitor({ extraHTTPHeaders: { "Sec-GPC": "1" } });
  await (await gpc.newPage()).goto(`${ORIGIN}/wiki`);
  const dnt = await visitor({ extraHTTPHeaders: { DNT: "1" } });
  await (await dnt.newPage()).goto(`${ORIGIN}/wiki`);
  const bot = await visitor({ userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1)" });
  await (await bot.newPage()).goto(`${ORIGIN}/wiki`);

  // One control visit proves the counter is alive and the waits above were long enough.
  const control = await visitor();
  await (await control.newPage()).goto(`${ORIGIN}/wiki`);
  await expect.poll(total).toBe(1);
  await Promise.all([local, gpc, dnt, bot, control].map((context) => context.close()));
});

test("the visit-count control works without JavaScript and is independent of PostHog", async () => {
  const context = await visitor({ javaScriptEnabled: false });
  const page = await context.newPage();

  // The first load may be counted before the control can be used: say so honestly.
  await page.goto(`${ORIGIN}/wiki/safety-and-privacy`);
  await expect.poll(total).toBe(1);
  await expect(page.getByTestId("visit-count-control")).toBeVisible();

  await page.getByRole("button", { name: "Do not count my visits" }).click();
  await expect(page.getByRole("status")).toContainText("won't count your visits");
  const cookies = await context.cookies(ORIGIN);
  expect(cookies.find((cookie) => cookie.name === "rs_stats_optout")?.value).toBe("1");
  // The PostHog choice is a different cookie and is untouched.
  expect(cookies.some((cookie) => cookie.name === "rs_analytics_choice")).toBe(false);

  await page.goto(`${ORIGIN}/wiki`);
  await page.goto(`${ORIGIN}/updates`);
  await page.waitForTimeout(500);
  expect(await total()).toBe(1);

  // Counting again is as easy as stopping, even without JavaScript.
  await page.goto(`${ORIGIN}/wiki/safety-and-privacy`);
  await page.getByRole("button", { name: "Count my visits again" }).click();
  await expect(page.getByRole("status")).toContainText("count your visits again");
  expect((await context.cookies(ORIGIN)).some((cookie) => cookie.name === "rs_stats_optout")).toBe(
    false,
  );
  await page.goto(`${ORIGIN}/wiki`);
  await expect.poll(total).toBe(2);
  await context.close();
});

test("the in-page control saves on the spot, survives a reload, and can be undone", async () => {
  const context = await visitor();
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/wiki/safety-and-privacy`);
  await expect.poll(total).toBe(1);

  const control = page.getByTestId("visit-count-control");
  await control.getByRole("button", { name: "Do not count my visits" }).click();
  await expect(control.getByTestId("visit-count-status")).toContainText("aren't counted");
  await expect(control.getByRole("button", { name: "Count my visits again" })).toBeVisible();

  await page.reload();
  await expect(control.getByRole("button", { name: "Count my visits again" })).toBeVisible();
  await page.goto(`${ORIGIN}/wiki`);
  await page.waitForTimeout(500);
  expect(await total()).toBe(1);

  await page.goto(`${ORIGIN}/wiki/safety-and-privacy#visit-count-settings`);
  await page.getByRole("button", { name: "Count my visits again" }).click();
  await expect(page.getByRole("button", { name: "Do not count my visits" })).toBeVisible();
  await page.goto(`${ORIGIN}/wiki`);
  await expect.poll(total).toBe(2);
  await context.close();
});
