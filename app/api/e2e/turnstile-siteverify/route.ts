import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { E2E_TURNSTILE_PASS_TOKEN, isLocalE2eRuntime } from "@/server/local-e2e";

/**
 * Loopback stand-in for Cloudflare's Turnstile `siteverify` (issue #221),
 * reachable ONLY inside the repository's local-E2E runtime gate
 * (`server/local-e2e.ts`); everywhere else — previews and production included
 * — it is a plain 404. The E2E runners point the Captcha plugin here so browser
 * journeys exercise the real server-side verification path without calling
 * Cloudflare. It answers in Cloudflare's response shape and passes only the
 * runner's own secret paired with the fixed E2E token.
 */
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!isLocalE2eRuntime()) {
    return new NextResponse("Not Found", { status: 404 });
  }
  const body = (await request.json().catch(() => null)) as {
    secret?: unknown;
    response?: unknown;
  } | null;
  const success =
    body?.secret === env.TURNSTILE_SECRET_KEY && body?.response === E2E_TURNSTILE_PASS_TOKEN;
  return NextResponse.json({
    success,
    hostname: "127.0.0.1",
    "error-codes": success ? [] : ["invalid-input-response"],
  });
}
