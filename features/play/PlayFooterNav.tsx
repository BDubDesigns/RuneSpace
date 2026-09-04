"use client";

import Link from "next/link";
import type { ComponentProps, ReactNode, Ref } from "react";

type FooterDestinationProps = {
  icon: ReactNode;
  label: string;
  badgeCount?: number;
  active?: boolean;
};

export type FooterBadgeTone = "mission" | "neutral" | "urgent";

function badgeClassName(tone: FooterBadgeTone): string {
  const base =
    "absolute right-1 top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full border px-1 font-display text-[10px] font-bold";
  if (tone === "mission") {
    return `${base} border-[color:var(--rs-mission-border)] bg-[color:var(--rs-mission-surface-subtle)] text-[color:var(--rs-mission-accent-strong)]`;
  }
  if (tone === "urgent") {
    return `${base} border-[color:var(--rs-accent-danger)] bg-[color:var(--rs-accent-danger-subtle)] text-[color:var(--rs-accent-danger)]`;
  }
  return `${base} border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] text-[color:var(--rs-text-secondary)]`;
}

function destinationClassName(active: boolean): string {
  return `rs-bevel rs-focus relative flex min-h-[var(--rs-touch-target)] flex-1 flex-col items-center justify-center gap-0.5 border px-1 py-1 text-center transition duration-[var(--rs-duration-fast)] ${
    active
      ? "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)] text-[color:var(--rs-accent-primary)]"
      : "border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] text-[color:var(--rs-text-primary)] hover:border-[color:var(--rs-accent-secondary)]"
  }`;
}

function DestinationContent({
  icon,
  label,
  badgeCount,
  freeSlotsCount,
}: Omit<FooterDestinationProps, "active"> & { freeSlotsCount?: number }) {
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
          className={badgeClassName("mission")}
          data-missions-badge={badgeCount}
        >
          {badgeCount}
        </span>
      ) : null}
      {freeSlotsCount !== undefined ? (
        <span
          aria-hidden="true"
          className={badgeClassName(freeSlotsCount > 0 ? "neutral" : "urgent")}
          data-inventory-free-badge={freeSlotsCount}
        >
          {freeSlotsCount}
        </span>
      ) : null}
    </>
  );
}

export function FooterNavLink({
  icon,
  label,
  badgeCount,
  freeSlotsCount,
  active,
  "aria-label": ariaLabel,
  ...props
}: FooterDestinationProps & ComponentProps<typeof Link> & { freeSlotsCount?: number }) {
  return (
    <Link
      {...props}
      aria-label={ariaLabel ?? label}
      className={destinationClassName(active ?? false)}
    >
      <DestinationContent
        badgeCount={badgeCount}
        freeSlotsCount={freeSlotsCount}
        icon={icon}
        label={label}
      />
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
  freeSlotsCount,
  active,
  ref,
  "aria-label": ariaLabel,
  ...props
}: FooterNavButtonProps & { freeSlotsCount?: number }) {
  return (
    <button
      {...props}
      aria-label={ariaLabel ?? label}
      className={destinationClassName(active ?? false)}
      ref={ref}
      type="button"
    >
      <DestinationContent
        badgeCount={badgeCount}
        freeSlotsCount={freeSlotsCount}
        icon={icon}
        label={label}
      />
    </button>
  );
}
