import { statsOptOutCookie } from "@/features/analytics/referral-counts";
import { SAFETY_PRIVACY_PATH } from "@/features/public-site/policy-links";

/**
 * The no-JavaScript path for the visit-count objection (issue #425). The
 * Safety & Privacy control posts a plain form here; with JavaScript the control
 * sets the same cookie in the page instead. `choice=off` records "don't count my
 * visits"; `choice=on` clears it. Only the `rs_stats_optout` cookie is touched,
 * so the PostHog choice is unaffected. The reply is a small self-contained page
 * (no redirect to follow, nothing user-supplied echoed).
 */
export const dynamic = "force-dynamic";

/**
 * Only the site's own form may change the preference. A cross-site page could
 * otherwise post `choice=on` and silently clear a visitor's objection (browsers
 * accept `Set-Cookie` on the response to a cross-site top-level form post).
 * Browsers state the initiator in `Sec-Fetch-Site`, and send `Origin` on form
 * posts; either one that names another site is refused, and a request carrying
 * neither is refused too (fail closed).
 */
function isSameOrigin(request: Request): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  if (!origin) return false;
  const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  try {
    return !!host && new URL(origin).host.toLowerCase() === host.toLowerCase();
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) {
    return new Response(
      "This choice can only be changed from RuneSpace's own Safety & Privacy page.",
      {
        status: 403,
        headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
      },
    );
  }
  let choice: string | null = null;
  try {
    const form = await request.formData();
    const value = form.get("choice");
    choice = typeof value === "string" ? value : null;
  } catch {
    /* an unreadable body is treated as no valid choice */
  }
  if (choice !== "off" && choice !== "on") {
    return new Response("Choose “off” or “on”.", {
      status: 400,
      headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const secure =
    request.headers.get("x-forwarded-proto") === "https" ||
    new URL(request.url).protocol === "https:";
  const counting = choice === "on";
  const message = counting
    ? "Okay: RuneSpace will count your visits again in its anonymous daily totals."
    : "Done: RuneSpace won't count your visits in its anonymous daily totals.";

  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex"><title>Visit-count choice saved — RuneSpace</title><style>body{margin:0;background:#0b0f17;color:#e6e9f0;font:16px/1.6 system-ui,sans-serif}main{max-width:36rem;margin:0 auto;padding:4rem 1.25rem}a{color:#7cc4ff}</style></head><body><main><h1>Saved</h1><p role="status">${message}</p><p>This is separate from the PostHog analytics choice, which you can change on the same page.</p><p><a href="${SAFETY_PRIVACY_PATH}#visit-count-settings">Back to Safety &amp; Privacy</a></p></main></body></html>`,
    {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "set-cookie": statsOptOutCookie(counting, secure),
      },
    },
  );
}
