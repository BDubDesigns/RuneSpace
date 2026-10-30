import { createHash, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { env } from "@/server/env";
import { reportScapelikesPresence } from "@/server/scapelikes-presence";

export const dynamic = "force-dynamic";
const noStore = { "cache-control": "no-store" };

export async function POST(request: Request) {
  const secret = env.SCAPELIKES_PRESENCE_CRON_SECRET;
  const supplied = request.headers.get("authorization") ?? "";
  // Compare fixed-length hashes and fail closed if the configured secret is weak.
  const digest = (value: string) => createHash("sha256").update(value).digest();
  if (
    !secret ||
    secret.length < 32 ||
    !timingSafeEqual(digest(supplied), digest(`Bearer ${secret}`))
  ) {
    return new NextResponse(null, { status: 401, headers: noStore });
  }

  const params = new URL(request.url).searchParams;
  if (
    [...params.keys()].some((key) => key !== "dry_run") ||
    params.getAll("dry_run").length > 1 ||
    (params.has("dry_run") && params.get("dry_run") !== "1")
  ) {
    return new NextResponse(null, { status: 400, headers: noStore });
  }
  const siteId = env.SCAPELIKES_SITE_ID;
  if (!siteId || siteId === "." || siteId === "..") {
    return NextResponse.json(
      { error: "Presence reporting is not configured." },
      { status: 503, headers: noStore },
    );
  }
  try {
    await reportScapelikesPresence(siteId, params.has("dry_run"));
    return new NextResponse(null, { status: 204, headers: noStore });
  } catch {
    // Never log exceptions: fetch errors can contain the private provider URL.
    console.error("[scapelikes-presence] Report failed.");
    return NextResponse.json(
      { error: "Presence report failed." },
      { status: 502, headers: noStore },
    );
  }
}
