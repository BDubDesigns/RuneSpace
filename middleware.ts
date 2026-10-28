import { NextResponse, type NextFetchEvent, type NextRequest } from "next/server";
import { referralCountLabels } from "@/features/analytics/referral-counts";
import { isLocalE2eRuntime } from "@/server/local-e2e";
import { recordReferralVisit } from "@/server/referral-counts";

/**
 * First-party aggregate referral counter (issue #425).
 *
 * Middleware is the one place that sees every document navigation, including
 * the statically generated Wiki and Updates pages that no layout, page, or
 * route handler runs for. It runs on the Node.js runtime so it can reach
 * PostgreSQL directly; see `server/referral-counts.ts` for why there is no
 * buffer or instrumentation flusher, and `docs/analytics.md` for the contract.
 *
 * It never changes the response. Counting is judged by `referralCountLabels`
 * (production host only, public pages only, no privacy signal or objection) and
 * written after the response has started, so a slow or unavailable database
 * cannot delay or fail a page load.
 *
 * `matcher` is narrowed to the public routes that can be counted so the game
 * (`/play`, `/characters`), the API, operator surfaces, and static assets never
 * enter this function. Keep it in step with `COUNTED_CATEGORIES`
 * (`tests/unit/referral-counts.test.ts` checks that it is).
 */
export const config = {
  runtime: "nodejs",
  matcher: [
    "/",
    "/updates",
    "/updates/:path*",
    "/wiki",
    "/wiki/:path*",
    "/high-scores",
    "/high-scores/:path*",
    "/register",
    "/sign-in",
  ],
};

// The repository's disposable E2E runners (CI + plain-HTTP flag + loopback
// database; never a preview or production) may count the exact host
// `localhost`, which no other spec uses, so a browser journey can prove the
// real counter without touching production rules.
const E2E_COUNTING_HOSTNAME = isLocalE2eRuntime() ? "localhost" : undefined;

export function middleware(request: NextRequest, event: NextFetchEvent) {
  try {
    const labels = referralCountLabels(
      {
        method: request.method,
        pathname: request.nextUrl.pathname,
        search: request.nextUrl.search,
        headers: request.headers,
      },
      { extraHostname: E2E_COUNTING_HOSTNAME },
    );
    if (labels) event.waitUntil(recordReferralVisit(labels));
  } catch {
    /* counting must never affect a page load */
  }
  return NextResponse.next();
}
