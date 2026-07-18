"use client";

import { useRouter } from "next/navigation";
import { authClient } from "./auth-client";

/**
 * Sign-out button (client component). Clears the Better Auth session cookie via
 * the `/api/auth/*` route natively, then returns to the landing page.
 */
export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={async () => {
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
      className="text-sm text-slate-400 underline"
    >
      Sign out
    </button>
  );
}
