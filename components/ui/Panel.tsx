import type { HTMLAttributes, ReactNode } from "react";

type PanelProps = HTMLAttributes<HTMLElement> & {
  children: ReactNode;
  tone?: "default" | "raised";
  as?: "section" | "div" | "li";
};

export function Panel({
  children,
  className = "",
  tone = "default",
  as: Element = "section",
  ...props
}: PanelProps) {
  const surface =
    tone === "raised"
      ? "bg-[color:var(--rs-surface-raised)]"
      : "bg-[color:var(--rs-surface-panel)]";
  return (
    <Element
      {...props}
      className={`rs-bevel border border-[color:var(--rs-border-structural)] p-5 shadow-[var(--rs-shadow-panel)] ${surface} ${className}`}
    >
      {children}
    </Element>
  );
}
