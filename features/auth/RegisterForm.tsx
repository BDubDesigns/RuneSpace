"use client";

import { useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { FormField } from "@/components/ui/FormField";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { TextLink } from "@/components/ui/TextLink";
import { PLAYER_NAME_MAX, validatePlayerName } from "@/game/domain/player-name";
import { authClient, VERIFIED_CALLBACK_PATH } from "./auth-client";
import { authErrorMessage, type AuthClientError } from "./auth-errors";
import { TurnstileWidget } from "./TurnstileWidget";
import { VerificationPending } from "./VerificationPending";

/** The first link is sent at sign-up, so the resend cooldown starts immediately. */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Soft-alpha registration (issue #221): Player name + email + password,
 * protected by Turnstile. Sign-up creates the account without a session and
 * sends a verification link; the flow then shows "Check your email".
 *
 * The shared Player-name rules give early feedback here; Better Auth re-runs
 * them server-side, together with uniqueness, the Turnstile check, and the
 * signup limits.
 */
export function RegisterForm({ siteKey }: { siteKey: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [challenge, setChallenge] = useState(0);
  const [registeredEmail, setRegisteredEmail] = useState<string | null>(null);

  if (registeredEmail) {
    return (
      <VerificationPending
        email={registeredEmail}
        siteKey={siteKey}
        initialCooldownSeconds={RESEND_COOLDOWN_SECONDS}
        onCreateDifferentAccount={() => {
          setRegisteredEmail(null);
          setError(null);
        }}
      />
    );
  }

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    const form = new FormData(event.currentTarget);
    const playerName = validatePlayerName(String(form.get("playerName") ?? ""));
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!playerName.ok) {
      setError(playerName.error);
      return;
    }
    if (!token) {
      setError("Please complete the security check.");
      return;
    }

    setPending(true);
    const { error } = await authClient.signUp.email(
      {
        name: playerName.display,
        username: playerName.display,
        displayUsername: playerName.display,
        email,
        password,
        callbackURL: VERIFIED_CALLBACK_PATH,
      },
      { headers: { "x-captcha-response": token } },
    );
    setPending(false);
    // Turnstile tokens are single-use: always issue a fresh challenge.
    setChallenge((value) => value + 1);
    if (error) {
      setError(authErrorMessage(error as AuthClientError, "Could not create account."));
      return;
    }
    setRegisteredEmail(email);
  }

  return (
    <div>
      <SectionHeader eyebrow="Soft alpha reservation">
        Reserve your place in RuneSpace
      </SectionHeader>
      <p className="mt-3 text-sm text-[color:var(--rs-text-secondary)]">
        Create your account now to reserve up to three character names before RuneSpace Soft Alpha
        opens October 27.
      </p>
      <p className="mt-3 text-sm text-[color:var(--rs-text-secondary)]">
        You’ll need to verify your email before you can create characters or enter the game.
      </p>

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <FormField
          id="playerName"
          name="playerName"
          type="text"
          required
          maxLength={PLAYER_NAME_MAX * 2}
          autoComplete="username"
          label="Player name"
          description="Your account identity. Other players can see this as the owner of your characters."
        />
        <FormField
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          label="Email"
        />
        <FormField
          id="password"
          name="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          label="Password"
        />
        <TurnstileWidget key={challenge} siteKey={siteKey} onToken={setToken} />
        {error ? <Feedback tone="danger">{error}</Feedback> : null}
        <ActionButton type="submit" loading={pending} className="w-full">
          {pending ? "Creating account" : "Create account"}
        </ActionButton>
      </form>

      <p className="mt-4 text-sm text-[color:var(--rs-text-muted)]">
        One person, one RuneSpace account. Every account includes three character slots.
      </p>

      <section className="mt-6 border-t border-[color:var(--rs-border-subtle)] pt-4">
        <h2 className="text-sm font-semibold text-[color:var(--rs-text-primary)]">
          Your email stays yours.
        </h2>
        <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
          QC Failed won’t sell your email address or hand it to advertisers. It’s used for
          account/security messages and launch/development email only when a separate explicit
          opt-in system exists.
        </p>
        <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
          I’m trying to build QC Failed into a company people can actually trust. Jeopardizing that
          trust for a mailing list or a quick buck would defeat the whole point.
        </p>
      </section>

      <p className="mt-6 text-sm text-[color:var(--rs-text-secondary)]">
        Already have an account? <TextLink href="/sign-in">Sign in</TextLink>
      </p>
    </div>
  );
}
