"use client";

import { useRouter } from "next/navigation";
import { authClient } from "./auth-client";
import { ActionButton } from "@/components/ui/ActionButton";

/**
 * Sign-out button (client component). Clears the Better Auth session cookie via
 * the `/api/auth/*` route natively, then returns to the landing page.
 */
export function SignOutButton() {
  const router = useRouter();

  return (
    <ActionButton
      type="button"
      onClick={async () => {
        await authClient.signOut();
        router.push("/");
        router.refresh();
      }}
      intent="secondary"
    >
      Sign out
    </ActionButton>
  );
}
