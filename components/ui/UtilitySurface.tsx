import type { ReactNode, RefObject } from "react";
import { Drawer } from "./Drawer";

/**
 * How an ordinary, nonblocking utility reaches the player (#286): the one seam
 * between a docked region of the page and a modal Drawer, so a new utility never
 * needs its own desktop overlay.
 *
 * - `"modal"` is exactly the shared `Drawer`: portal, `aria-modal`, backdrop,
 *   body scroll lock, Escape, a focus trap and focus return to `triggerRef`.
 * - `"docked"` is an ordinary complementary region of the page: none of those.
 *   It is a tab panel the caller places in its rail; nothing is trapped, locked,
 *   portaled or announced as a dialog, and Escape is left to the page.
 *
 * The caller mounts exactly one of these per utility, picking `presentation`
 * from the viewport — never both, and never one hidden with CSS — and passes the
 * same content either way, so the two presentations cannot drift into separate
 * features. Exclusive, space-sensitive interactions (an accepted player trade,
 * a mandatory reveal, a destructive confirmation) are not utilities: they stay
 * foreground `Drawer`s at every width.
 */
export type UtilityPresentation = "docked" | "modal";

/** How a docked utility region joins the page's tab list. */
export type DockedUtilityRegion = {
  /** The id of this region, referenced by the tab's `aria-controls`. */
  id: string;
  /** The id of the tab that labels this region. */
  labelledBy: string;
  /** Compact controls above the content, such as "Set as default". */
  actions?: ReactNode;
};

export function UtilitySurface({
  presentation,
  label,
  title,
  eyebrow,
  onClose,
  triggerRef,
  docked,
  children,
}: {
  presentation: UtilityPresentation;
  /** The accessible name of the dialog (modal) or region (docked). */
  label: string;
  title: string;
  eyebrow: string;
  /** Modal only: the Drawer's own Close, Escape and backdrop path. */
  onClose?: () => void;
  /** Modal only: where focus returns when the Drawer closes. */
  triggerRef?: RefObject<HTMLButtonElement | null>;
  /** Docked only: how the region joins the page's tab list. */
  docked?: DockedUtilityRegion;
  children: ReactNode;
}) {
  if (presentation === "modal") {
    return (
      <Drawer
        eyebrow={eyebrow}
        label={label}
        onClose={onClose}
        title={title}
        triggerRef={triggerRef}
      >
        {children}
      </Drawer>
    );
  }
  return (
    <section
      aria-labelledby={docked?.labelledBy}
      aria-label={docked?.labelledBy ? undefined : label}
      // A column, so a utility that wants the height it is given (Chat's message
      // log, which grows from a minimum when it finds itself under
      // `[data-docked-utility]`) can fill it, while one that does not simply
      // stacks and scrolls the panel. The padding matches the Drawer's, because content written for either
      // presentation (the Character panel's sticky Switch Character bar, for one)
      // is laid out against that inset.
      className="flex min-h-0 flex-1 flex-col overflow-y-auto border border-[color:var(--rs-border-structural)] bg-[color:var(--rs-surface-raised)] px-4 pb-4 pt-2"
      data-docked-utility={label}
      id={docked?.id}
      role="tabpanel"
    >
      {docked?.actions}
      {children}
    </section>
  );
}
