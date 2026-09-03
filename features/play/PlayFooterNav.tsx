"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode, Ref } from "react";

type FooterDestinationProps = {
  icon: ReactNode;
  label: string;
  badgeCount?: number;
  active?: boolean;
};

function destinationClassName(active: boolean): string {
  return `rs-bevel rs-focus relative flex min-h-[var(--rs-touch-target)] flex-1 flex-col items-center justify-center gap-0.5 border px-1 py-1 text-center transition duration-[var(--rs-duration-fast)] ${
    active
      ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)] text-[color:var(--rs-accent-primary)]"
      : "border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] text-[color:var(--rs-text-primary)] hover:border-[color:var(--rs-accent-secondary)]"
  }`;
}

function DestinationContent({ icon, label, badgeCount }: Omit<FooterDestinationProps, "active">) {
  return (
    <>
      <span aria-hidden="true" className="[&>svg]:h-5 [&>svg]:w-5">
        {icon}
      </span>
      <span className="font-display text-[10px] uppercase leading-none tracking-[0.08em]">
        {label}
      </span>
      {badgeCount !== undefined && badgeCount > 0 ? (
        <span
          aria-hidden="true"
          className="absolute right-1 top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full border border-[color:var(--rs-mission-border)] bg-[color:var(--rs-mission-surface-subtle)] px-1 font-display text-[10px] font-bold text-[color:var(--rs-mission-accent-strong)]"
          data-missions-badge={badgeCount}
        >
          {badgeCount}
        </span>
      ) : null}
    </>
  );
}

export function FooterNavLink({
  icon,
  label,
  badgeCount,
  active,
  ...props
}: FooterDestinationProps & ComponentProps<typeof Link>) {
  return (
    <Link {...props} aria-label={label} className={destinationClassName(active ?? false)}>
      <DestinationContent badgeCount={badgeCount} icon={icon} label={label} />
    </Link>
  );
}

type FooterNavButtonProps = FooterDestinationProps &
  Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "children"> & {
    ref?: Ref<HTMLButtonElement>;
  };

export function FooterNavButton({
  icon,
  label,
  badgeCount,
  active,
  ref,
  ...props
}: FooterNavButtonProps) {
  return (
    <button
      {...props}
      aria-label={label}
      className={destinationClassName(active ?? false)}
      ref={ref}
      type="button"
    >
      <DestinationContent badgeCount={badgeCount} icon={icon} label={label} />
    </button>
  );
}
