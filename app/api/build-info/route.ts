import { NextResponse } from "next/server";
import { releaseId } from "@/server/diagnostics";

// Public-safe, unauthenticated build identity boundary (Issue #75).
//
// A reviewer asks a running deployment "which source revision was this build
// produced from?" and gets back the existing RUNESPACE_RELEASE_ID / release-id
// architecture — the same server-side helper the diagnostics already use — so
// there is exactly one release identity and no parallel version system.
//
// The response is explicitly build-id-limited: it exposes only the sanitized
// `releaseId` field and nothing else (no database, env dump, topology,
// container id, branch credential, or user data). When release metadata is
// absent the value is the explicit string "unknown" rather than a guessed or
// manufactured revision.
//
// force-dynamic + no-store keep the endpoint from being cached at build time,
// so it reflects the actually-deployed runtime artifact instead of serving a
// stale baked-in copy. This is review evidence, not a CI dependency.

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  return NextResponse.json(
    { releaseId: releaseId() ?? "unknown" },
    { headers: { "cache-control": "no-store" } },
  );
}
