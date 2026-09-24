"use client";

import { useEffect, useState } from "react";
import { ActionButton } from "@/components/ui/ActionButton";
import { Feedback } from "@/components/ui/Feedback";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { authClient, VERIFIED_CALLBACK_PATH } from "./auth-client";
import { authErrorMessage, formatCooldown, type AuthClientError } from "./auth-errors";
import { TurnstileWidget } from "./TurnstileWidget";

/** Matches the server's one-resend-per-60-seconds limit. */
const RESEND_COOLDOWN_SECONDS = 60;

/**
 * The "Check your email" state (issue #221), shown after sign-up and when an
 * unverified account tries to sign in. The explicit resend is the only way to
 * request another link; it carries a fresh Turnstile token and the server
 * enforces the cooldown and daily cap, which this countdown only mirrors.
 */
export function VerificationPending({
  email,
  siteKey,
  initialCooldownSeconds,
  onCreateDifferentAccount,
}: {
  email: string;
  siteKey: string | null;
  initialCooldownSeconds: number;
  onCreateDifferentAccount: () => void;
}) {
  const [cooldown, setCooldown] = useState(initialCooldownSeconds);
  const [token, setToken] = useState<string | null>(null);
  const [challenge, setChallenge] = useState(0);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "danger"; text: string } | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((seconds) => seconds - 1), 1_000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function resend() {
    if (!token) {
      setNotice({ tone: "danger", text: "Please complete the security check." });
      return;
    }
    setPending(true);
    setNotice(null);
    const { error } = await authClient.sendVerificationEmail(
      { email, callbackURL: VERIFIED_CALLBACK_PATH },
      { headers: { "x-captcha-response": token } },
    );
    setPending(false);
    setChallenge((value) => value + 1);
    if (error) {
      const detail = error as AuthClientError;
      if (detail.retryAfterSeconds) setCooldown(detail.retryAfterSeconds);
      setNotice({
        tone: "danger",
        text: authErrorMessage(detail, "Could not send the verification email."),
      });
      return;
    }
    setCooldown(RESEND_COOLDOWN_SECONDS);
    setNotice({ tone: "success", text: "Verification email sent." });
  }

  return (
    <div>
      <SectionHeader eyebrow="One more step">Check your email</SectionHeader>
      <p className="mt-3 text-sm text-[color:var(--rs-text-secondary)]">
        We sent a verification link to{" "}
        <strong className="break-all text-[color:var(--rs-text-primary)]">{email}</strong>.
      </p>
      <p className="mt-3 text-sm text-[color:var(--rs-text-secondary)]">
        Verify your address to unlock character creation and reserve your names before Soft Alpha
        opens October 27.
      </p>
      <p className="mt-3 text-sm text-[color:var(--rs-text-muted)]">
        We only need this to confirm the account belongs to you and help protect RuneSpace from
        disposable accounts and name squatting.
      </p>

      <div className="mt-6 space-y-3">
        {cooldown > 0 ? (
          <p className="text-sm text-[color:var(--rs-text-muted)]">
            You can request another verification email in {formatCooldown(cooldown)}.
          </p>
        ) : siteKey ? (
          <TurnstileWidget key={challenge} siteKey={siteKey} onToken={setToken} />
        ) : null}
        <ActionButton
          type="button"
          intent="secondary"
          className="w-full"
          loading={pending}
          disabled={cooldown > 0 || !siteKey}
          onClick={resend}
        >
          Resend verification email
        </ActionButton>
        {notice ? <Feedback tone={notice.tone}>{notice.text}</Feedback> : null}
      </div>

      <p className="mt-6 text-sm text-[color:var(--rs-text-secondary)]">
        Used the wrong email?{" "}
        <button
          type="button"
          onClick={onCreateDifferentAccount}
          className="rs-focus text-[color:var(--rs-accent-primary)] underline"
        >
          Create a different account
        </button>
      </p>
    </div>
  );
}
