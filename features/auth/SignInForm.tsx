"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "./auth-client";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { FormField } from "@/components/ui/FormField";

/**
 * Sign-in form (client component).
 *
 * Uses Better Auth's client to sign in, which sets the session cookie natively
 * through the `/api/auth/*` route. On success we navigate to the character
 * selection screen.
 */
export function SignInForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    const { error } = await authClient.signIn.email({ email, password });
    setPending(false);
    if (error) {
      setError(error.message ?? "Could not sign in");
      return;
    }
    router.push("/characters");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <FormField id="email" name="email" type="email" required autoComplete="email" label="Email" />
      <FormField
        id="password"
        name="password"
        type="password"
        required
        autoComplete="current-password"
        label="Password"
      />
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      <ActionButton type="submit" loading={pending} className="w-full">
        {pending ? "Signing in" : "Sign in"}
      </ActionButton>
    </form>
  );
}
