import type { ReactNode } from "react";
import { Panel } from "./ui/Panel";

/**
 * Presentational smoke-screen card.
 *
 * This is a reusable visual primitive (no feature behavior, no game rules).
 * It is the only UI surface the scaffold renders. Keeping it here — rather than
 * inline in the page — establishes the `components/` boundary: pure styling and
 * layout that any future page could reuse.
 *
 * The `wide` size exists only for the character-creation page, whose shared
 * portrait chooser needs room for the desktop master-detail layout; every
 * other surface keeps the default width.
 */

export function ScaffoldScreen({
  children,
  size = "default",
}: {
  children: ReactNode;
  size?: "default" | "wide";
}) {
  return (
    <main className="rs-viewport-shell flex items-center justify-center px-4 py-10">
      <Panel className={`w-full ${size === "wide" ? "max-w-md lg:max-w-4xl" : "max-w-md"} sm:p-7`}>
        {children}
      </Panel>
    </main>
  );
}
