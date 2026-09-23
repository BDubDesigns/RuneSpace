import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { Feedback } from "@/components/ui/Feedback";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { TextLink } from "@/components/ui/TextLink";
import { RegisterForm } from "@/features/auth/RegisterForm";
import { publicRegistrationSiteKey } from "@/server/account-protection";

export const metadata = { title: "Register — RuneSpace" };

// The Turnstile site key and registration availability are runtime
// configuration, never baked into the build.
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  const siteKey = publicRegistrationSiteKey();
  return (
    <ScaffoldScreen>
      {siteKey ? (
        <RegisterForm siteKey={siteKey} />
      ) : (
        <>
          <SectionHeader eyebrow="Soft alpha reservation">
            Reserve your place in RuneSpace
          </SectionHeader>
          <Feedback tone="danger">
            Account registration is temporarily unavailable. Please check back soon.
          </Feedback>
          <p className="mt-6 text-sm text-[color:var(--rs-text-secondary)]">
            Already have an account? <TextLink href="/sign-in">Sign in</TextLink>
          </p>
        </>
      )}
    </ScaffoldScreen>
  );
}
