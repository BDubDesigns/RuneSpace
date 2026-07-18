import Link from "next/link";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { SignInForm } from "@/features/auth/SignInForm";

export const metadata = { title: "Sign in — RuneSpace" };

/** Sign-in screen. Deliberately plain; final design system is a later issue. */
export default function SignInPage() {
  return (
    <ScaffoldScreen>
      <h1 className="font-mono text-2xl font-bold tracking-tight text-emerald-400">Sign in</h1>
      <p className="mt-2 text-sm text-slate-400">Access your RuneSpace account.</p>
      <SignInForm />
      <p className="mt-6 text-sm text-slate-400">
        New here?{" "}
        <Link href="/register" className="text-emerald-400 underline">
          Create an account
        </Link>
      </p>
    </ScaffoldScreen>
  );
}
