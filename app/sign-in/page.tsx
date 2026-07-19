import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { TextLink } from "@/components/ui/TextLink";
import { SignInForm } from "@/features/auth/SignInForm";

export const metadata = { title: "Sign in — RuneSpace" };

export default function SignInPage() {
  return (
    <ScaffoldScreen>
      <SectionHeader eyebrow="Account access">Sign in</SectionHeader>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Access your RuneSpace account.
      </p>
      <SignInForm />
      <p className="mt-6 text-sm text-[color:var(--rs-text-secondary)]">
        New here? <TextLink href="/register">Create an account</TextLink>
      </p>
    </ScaffoldScreen>
  );
}
