import { NextResponse } from "next/server";
import { loadSanctionNotices } from "@/server/moderation-notices";
import { requireCurrentUser, OwnershipError } from "@/server/ownership";

/**
 * Authenticated read of the account's own moderation notices (issue #248).
 * Account management, not gameplay: it needs only a session, so the
 * Chat/Social drawer can show a social restriction and a suspended player's
 * pages can still load their notice. Nothing here names a reporter or a
 * moderator.
 */
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const user = await requireCurrentUser(request.headers);
    const result = await loadSanctionNotices(user.id);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof OwnershipError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
}
