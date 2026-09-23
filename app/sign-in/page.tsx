import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { TextLink } from "@/components/ui/TextLink";
import { SignInForm } from "@/features/auth/SignInForm";
import { publicRegistrationSiteKey } from "@/server/account-protection";

export const metadata = { title: "Sign in — RuneSpace" };

// The Turnstile site key for the verification resend is runtime configuration.
export const dynamic = "force-dynamic";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ verification?: string }>;
}) {
  const { verification } = await searchParams;
  return (
    <ScaffoldScreen>
      <SectionHeader eyebrow="Account access">Sign in</SectionHeader>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Access your RuneSpace account.
      </p>
      <SignInForm
        siteKey={publicRegistrationSiteKey()}
        notice={
          verification === "invalid"
            ? "That verification link is invalid or has expired. Sign in to request a new one."
            : undefined
        }
      />
      <p className="mt-6 text-sm text-[color:var(--rs-text-secondary)]">
        New here? <TextLink href="/register">Create an account</TextLink>
      </p>
    </ScaffoldScreen>
  );
}
