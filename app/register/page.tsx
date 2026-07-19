import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { SectionHeader } from "@/components/ui/SectionHeader";
import { TextLink } from "@/components/ui/TextLink";
import { RegisterForm } from "@/features/auth/RegisterForm";

export const metadata = { title: "Register — RuneSpace" };

export default function RegisterPage() {
  return (
    <ScaffoldScreen>
      <SectionHeader eyebrow="Account access">Create account</SectionHeader>
      <p className="mt-2 text-sm text-[color:var(--rs-text-secondary)]">
        Register with email and password.
      </p>
      <RegisterForm />
      <p className="mt-6 text-sm text-[color:var(--rs-text-secondary)]">
        Already have an account? <TextLink href="/sign-in">Sign in</TextLink>
      </p>
    </ScaffoldScreen>
  );
}
