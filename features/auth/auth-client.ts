import { createAuthClient } from "better-auth/react";

/**
 * Browser-side Better Auth client.
 *
 * Uses the current origin by default, talking to the API route mounted at
 * `/api/auth/*` (see `app/api/auth/[...all]/route.ts`). This is the canonical
 * integration: Better Auth sets the session cookie on the HTTP response
 * natively, so the browser stores it correctly (no manual cookie bridging,
 * which previously double-encoded the token and broke server-action auth).
 */
export const authClient = createAuthClient({});
