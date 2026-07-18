"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "./auth-client";

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
      <div>
        <label htmlFor="name" className="block text-sm text-slate-300">
          Display name
        </label>
        <input
          id="name"
          name="name"
          type="text"
          required
          autoComplete="nickname"
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500"
        />
      </div>
      <div>
        <label htmlFor="email" className="block text-sm text-slate-300">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500"
        />
      </div>
      <div>
        <label htmlFor="password" className="block text-sm text-slate-300">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          className="mt-1 w-full rounded-lg border border-slate-800 bg-slate-950/60 px-3 py-2 text-slate-100 outline-none focus:border-emerald-500"
        />
      </div>
      {error ? <p className="text-sm text-red-400">{error}</p> : null}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-emerald-500 px-4 py-2 text-sm font-medium text-slate-950 transition hover:bg-emerald-400 disabled:opacity-60"
      >
        Create account
      </button>
    </form>
  );
}
