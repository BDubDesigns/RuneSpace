export type Intent = "primary" | "secondary" | "success" | "mining" | "arcane" | "danger";

export const intentClassNames: Record<Intent, string> = {
  primary:
    "border-[color:var(--rs-accent-primary)] bg-[color:var(--rs-accent-primary-subtle)] text-[color:var(--rs-accent-primary)] hover:bg-[color:var(--rs-accent-primary-hover)]",
  secondary:
    "border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-control)] text-[color:var(--rs-text-primary)] hover:border-[color:var(--rs-accent-secondary)]",
  success:
    "border-[color:var(--rs-accent-success)] bg-[color:var(--rs-accent-success-subtle)] text-[color:var(--rs-accent-success)] hover:bg-[color:var(--rs-accent-success-hover)]",
  mining:
    "border-[color:var(--rs-accent-mining)] bg-[color:var(--rs-accent-mining-subtle)] text-[color:var(--rs-accent-mining)] hover:bg-[color:var(--rs-accent-mining-hover)]",
  arcane:
    "border-[color:var(--rs-accent-arcane)] bg-[color:var(--rs-accent-arcane-subtle)] text-[color:var(--rs-accent-arcane)] hover:bg-[color:var(--rs-accent-arcane-hover)]",
  danger:
    "border-[color:var(--rs-accent-danger)] bg-[color:var(--rs-accent-danger-subtle)] text-[color:var(--rs-accent-danger)] hover:bg-[color:var(--rs-accent-danger-hover)]",
};
