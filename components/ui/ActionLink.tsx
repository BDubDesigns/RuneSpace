import Link from "next/link";
import type { ComponentProps } from "react";
import { intentClassNames, type Intent } from "./variants";

type ActionLinkProps = ComponentProps<typeof Link> & { intent?: Intent };

export function ActionLink({
  children,
  className = "",
  intent = "primary",
  ...props
}: ActionLinkProps) {
  return (
    <Link
      {...props}
      className={`rs-bevel rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center justify-center border px-4 py-2 text-sm font-semibold transition duration-[var(--rs-duration-fast)] ${intentClassNames[intent]} ${className}`}
    >
      {children}
    </Link>
  );
}
