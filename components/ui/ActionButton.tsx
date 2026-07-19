import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { intentClassNames, type Intent } from "./variants";

type ActionButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  children: ReactNode;
  intent?: Intent;
  loading?: boolean;
};

export const ActionButton = forwardRef<HTMLButtonElement, ActionButtonProps>(function ActionButton(
  { children, className = "", disabled, intent = "primary", loading = false, ...props },
  ref,
) {
  return (
    <button
      {...props}
      ref={ref}
      disabled={disabled || loading}
      className={`rs-bevel rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center justify-center gap-2 border px-4 py-2 text-sm font-semibold transition duration-[var(--rs-duration-fast)] disabled:cursor-not-allowed disabled:opacity-50 ${intentClassNames[intent]} ${className}`}
    >
      {loading ? <span aria-hidden="true">...</span> : null}
      {children}
    </button>
  );
});
