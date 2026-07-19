"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "./auth-client";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { FormField } from "@/components/ui/FormField";

/**
 * Registration form (client component).
 *
 * Uses Better Auth's client to sign up, which sets the session cookie natively
 * through the `/api/auth/*` route. On success we navigate to the character
 * selection screen. Validation is re-enforced server-side by the auth API.
 */
export function RegisterForm() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const form = new FormData(event.currentTarget);
    const name = String(form.get("name") ?? "");
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    const { error } = await authClient.signUp.email({ name, email, password });
    setPending(false);
    if (error) {
      setError(error.message ?? "Could not create account");
      return;
    }
    router.push("/characters");
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="mt-6 space-y-4">
      <FormField
        id="name"
        name="name"
        type="text"
        required
        autoComplete="nickname"
        label="Display name"
      />
      <FormField id="email" name="email" type="email" required autoComplete="email" label="Email" />
      <FormField
        id="password"
        name="password"
        type="password"
        required
        minLength={8}
        autoComplete="new-password"
        label="Password"
      />
      {error ? <Feedback tone="danger">{error}</Feedback> : null}
      <ActionButton type="submit" loading={pending} className="w-full">
        {pending ? "Creating account" : "Create account"}
      </ActionButton>
    </form>
  );
}
