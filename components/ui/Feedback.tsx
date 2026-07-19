import type { ReactNode } from "react";

export function Feedback({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "danger";
}) {
  const color =
    tone === "danger"
      ? "text-[color:var(--rs-accent-danger)]"
      : "text-[color:var(--rs-text-muted)]";
  return (
    <p className={`mt-3 text-sm ${color}`} role={tone === "danger" ? "alert" : undefined}>
      {children}
    </p>
  );
}
