export type Intent =
  | "primary"
  | "secondary"
  | "success"
  | "mining"
  | "arcane"
  | "fabrication"
  | "danger"
  | "mission";

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
  // Shop Olive (#232): the latched ON state of a Fabrication Station toggle.
  // The glow is inset because `.rs-bevel`'s clip-path cuts off anything outside.
  fabrication:
    "border-[color:var(--rs-accent-shop-olive)] bg-[color:var(--rs-accent-shop-olive-subtle)] text-[color:var(--rs-accent-shop-olive)] shadow-[inset_0_0_0_1px_var(--rs-accent-shop-olive),inset_0_0_12px_rgb(127_163_71_/_0.35)] hover:bg-[color:var(--rs-accent-shop-olive-hover)]",
  danger:
    "border-[color:var(--rs-accent-danger)] bg-[color:var(--rs-accent-danger-subtle)] text-[color:var(--rs-accent-danger)] hover:bg-[color:var(--rs-accent-danger-hover)]",
  mission:
    "border-[color:var(--rs-mission-border)] bg-[color:var(--rs-mission-surface-subtle)] text-[color:var(--rs-mission-accent-strong)] hover:bg-[color:var(--rs-mission-surface)]",
};
