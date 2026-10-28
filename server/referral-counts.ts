import { lt, sql } from "drizzle-orm";
import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { referralDailyCounts } from "@/db/site-analytics";
import {
  MAX_UTM_COMBINATIONS_PER_DAY,
  OVERFLOW_LABEL,
  REFERRAL_RETENTION_MONTHS,
  utcDay,
  type ReferralCountLabels,
} from "@/features/analytics/referral-counts";

/**
 * Persistence for the first-party aggregate referral counter (issue #425).
 *
 * Called from `middleware.ts` after a request has been judged countable. The
 * design is deliberately the simplest thing that can be reliable:
 *
 * - **One race-safe statement per counted page load**: `INSERT ... ON CONFLICT
 *   DO UPDATE SET visits = visits + 1` on the daily label row. Concurrent
 *   requests (and several app processes) cannot lose or duplicate an update.
 * - **No buffer, no background flusher.** Middleware and `instrumentation.ts`
 *   do not share module state (verified on Next 15.5.20, see
 *   `docs/analytics.md`), so a memory buffer drained by instrumentation would
 *   silently never flush. A direct upsert has nothing to share.
 * - **Bounded and isolated.** One small dedicated pool (never one per request),
 *   a cap on in-flight writes (excess page loads are simply not counted), a
 *   short statement timeout, and a back-off after any failure so a database
 *   outage costs a few skipped counts, not queued work or memory. `record`
 *   never throws and is never awaited by the page response.
 * - **Nothing individual is stored.** Only the sanitized labels in
 *   `ReferralCountLabels` and a count reach the database.
 *
 * State lives on `globalThis` so a duplicated module instance (or dev reloads)
 * still shares one pool and one cardinality tracker.
 */

const MAX_IN_FLIGHT = 200;
const FAILURE_BACKOFF_MS = 30_000;
const POOL_MAX = 2;

/** Any Drizzle node-postgres handle: the app's own, or the counter's dedicated pool. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type CounterDatabase = NodePgDatabase<any>;

export type ReferralCounterOptions = {
  /** Lazily resolved so importing this module never opens a connection. */
  database: () => CounterDatabase;
  now?: () => Date;
  maxInFlight?: number;
  failureBackoffMs?: number;
  maxUtmCombinationsPerDay?: number;
};

export type ReferralCounter = {
  /** Count one page load. Resolves when the write settles; never rejects. */
  record(labels: ReferralCountLabels): Promise<void>;
  /** Delete rows older than the retention window. Never rejects. */
  prune(): Promise<void>;
};

export function createReferralCounter(options: ReferralCounterOptions): ReferralCounter {
  const now = options.now ?? (() => new Date());
  const maxInFlight = options.maxInFlight ?? MAX_IN_FLIGHT;
  const backoffMs = options.failureBackoffMs ?? FAILURE_BACKOFF_MS;
  const maxCombinations = options.maxUtmCombinationsPerDay ?? MAX_UTM_COMBINATIONS_PER_DAY;

  let inFlight = 0;
  let pausedUntil = 0;
  let trackedDay = "";
  let combinations = new Set<string>();
  let prunedDay = "";

  /** Collapse a label set past the daily cardinality cap. */
  function bounded(labels: ReferralCountLabels, day: string): ReferralCountLabels {
    if (day !== trackedDay) {
      trackedDay = day;
      combinations = new Set();
    }
    if (!labels.utmSource && !labels.utmMedium && !labels.utmCampaign) return labels;
    const key = `${labels.utmSource}\u0000${labels.utmMedium}\u0000${labels.utmCampaign}`;
    if (combinations.has(key)) return labels;
    if (combinations.size < maxCombinations) {
      combinations.add(key);
      return labels;
    }
    return {
      ...labels,
      utmSource: OVERFLOW_LABEL,
      utmMedium: OVERFLOW_LABEL,
      utmCampaign: OVERFLOW_LABEL,
    };
  }

  async function guarded(work: () => Promise<unknown>): Promise<void> {
    if (inFlight >= maxInFlight || now().getTime() < pausedUntil) return;
    inFlight += 1;
    try {
      await work();
    } catch {
      pausedUntil = now().getTime() + backoffMs;
    } finally {
      inFlight -= 1;
    }
  }

  async function prune(): Promise<void> {
    await guarded(() =>
      options
        .database()
        .delete(referralDailyCounts)
        .where(
          lt(
            referralDailyCounts.day,
            sql`(${utcDay(now())}::date - ${`${REFERRAL_RETENTION_MONTHS} months`}::interval)::date`,
          ),
        ),
    );
  }

  async function record(labels: ReferralCountLabels): Promise<void> {
    try {
      const day = utcDay(now());
      const row = bounded(labels, day);
      await guarded(() =>
        options
          .database()
          .insert(referralDailyCounts)
          .values({
            day,
            sourceGroup: row.sourceGroup,
            utmSource: row.utmSource,
            utmMedium: row.utmMedium,
            utmCampaign: row.utmCampaign,
            routeCategory: row.routeCategory,
            visits: 1,
          })
          .onConflictDoUpdate({
            target: [
              referralDailyCounts.day,
              referralDailyCounts.sourceGroup,
              referralDailyCounts.utmSource,
              referralDailyCounts.utmMedium,
              referralDailyCounts.utmCampaign,
              referralDailyCounts.routeCategory,
            ],
            set: { visits: sql`${referralDailyCounts.visits} + 1` },
          }),
      );
      // Retention: one attempt per process per UTC day, off the request path.
      if (prunedDay !== day) {
        prunedDay = day;
        await prune();
      }
    } catch {
      /* counting must never affect a page load */
    }
  }

  return { record, prune };
}

// -- Process-wide instance ----------------------------------------------------

const globalForCounter = globalThis as unknown as {
  __runespaceReferralPool?: Pool;
  __runespaceReferralCounter?: ReferralCounter;
};

function referralDatabase(): NodePgDatabase {
  if (!globalForCounter.__runespaceReferralPool) {
    const pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      max: POOL_MAX,
      connectionTimeoutMillis: 2_000,
      idleTimeoutMillis: 30_000,
      statement_timeout: 3_000,
    });
    // An idle-client error must never become an unhandled 'error' event.
    pool.on("error", () => undefined);
    globalForCounter.__runespaceReferralPool = pool;
  }
  return drizzle(globalForCounter.__runespaceReferralPool);
}

/** Count one page load in the process-wide counter. Never throws. */
export function recordReferralVisit(labels: ReferralCountLabels): Promise<void> {
  globalForCounter.__runespaceReferralCounter ??= createReferralCounter({
    database: referralDatabase,
  });
  return globalForCounter.__runespaceReferralCounter.record(labels);
}
