import Link from "next/link";
import type { ComponentProps } from "react";

export function TextLink({ children, className = "", ...props }: ComponentProps<typeof Link>) {
  return (
    <Link
      {...props}
      className={`rs-focus text-[color:var(--rs-accent-primary)] underline ${className}`}
    >
      {children}
    </Link>
  );
}
