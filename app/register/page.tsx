import Link from "next/link";
import { ScaffoldScreen } from "@/components/ScaffoldScreen";
import { RegisterForm } from "@/features/auth/RegisterForm";

export const metadata = { title: "Register — RuneSpace" };

/** Registration screen. Deliberately plain; final design system is a later issue. */
export default function RegisterPage() {
  return (
    <ScaffoldScreen>
      <h1 className="font-mono text-2xl font-bold tracking-tight text-emerald-400">
        Create account
      </h1>
      <p className="mt-2 text-sm text-slate-400">Register with email and password.</p>
      <RegisterForm />
      <p className="mt-6 text-sm text-slate-400">
        Already have an account?{" "}
        <Link href="/sign-in" className="text-emerald-400 underline">
          Sign in
        </Link>
      </p>
    </ScaffoldScreen>
  );
}
