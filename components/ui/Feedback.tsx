import type { ReactNode } from "react";

/**
 * Shared inline feedback message. Tone maps to a semantic accent token and to
 * the correct announcement role: danger is an alert, success is a polite
 * status, and muted carries no role (its content is already visible context).
 */
export function Feedback({
  children,
  tone = "muted",
}: {
  children: ReactNode;
  tone?: "muted" | "danger" | "success";
}) {
  const color =
    tone === "danger"
      ? "text-[color:var(--rs-accent-danger)]"
      : tone === "success"
        ? "text-[color:var(--rs-accent-success)]"
        : "text-[color:var(--rs-text-muted)]";
  return (
    <p
      className={`mt-3 text-sm ${color}`}
      role={tone === "danger" ? "alert" : tone === "success" ? "status" : undefined}
    >
      {children}
    </p>
  );
}
