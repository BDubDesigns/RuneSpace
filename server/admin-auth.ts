import { adminUserIdAllowlist } from "@/server/env";
import { requireCurrentUser } from "@/server/ownership";

/**
 * Server-only admin/operator authorization (Issue #113).
 *
 * Admin power is granted solely by a server-side allowlist of stable Better
 * Auth user IDs configured through `RUNESPACE_ADMIN_USER_IDS`. There is no
 * database role table, no browser-authored role, and no hidden UI affordance
 * that can grant access: every admin read and mutation must authenticate the
 * request via Better Auth and then be authorized by `requireAdmin` (or by a
 * pure `isAdminUserId` check where the caller already holds a resolved user).
 *
 * Absent or empty configuration means NO admins — everything fails closed. An
 * ordinary authenticated user is never an admin, and normal character
 * ownership never implies admin power.
 */
export class AdminError extends Error {
  constructor(
    message: string,
    readonly status: number = 403,
  ) {
    super(message);
    this.name = "AdminError";
  }
}

/** Pure allowlist membership check over a Better Auth user id. */
export function isAdminUserId(userId: string): boolean {
  return adminUserIdAllowlist.includes(userId);
}

/**
 * Authenticate a request as a Better Auth user and require that user to be on
 * the server-only admin allowlist. Throws `AdminError` (403) for an
 * authenticated but non-admin user so they receive safe forbidden behavior and
 * cannot invoke admin commands. Authentication failures propagate the existing
 * 401 ownership error.
 */
export async function requireAdmin(
  headers: Headers,
): Promise<{ id: string; email: string; name: string }> {
  const user = await requireCurrentUser(headers);
  if (!isAdminUserId(user.id)) {
    throw new AdminError("Forbidden", 403);
  }
  return user;
}
