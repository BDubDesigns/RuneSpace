import type { ReactNode } from "react";
import { Panel } from "./ui/Panel";

/**
 * Presentational smoke-screen card.
 *
 * This is a reusable visual primitive (no feature behavior, no game rules).
 * It is the only UI surface the scaffold renders. Keeping it here — rather than
 * inline in the page — establishes the `components/` boundary: pure styling and
 * layout that any future page could reuse.
 */

export function ScaffoldScreen({ children }: { children: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <Panel className="w-full max-w-md sm:p-7">{children}</Panel>
    </main>
  );
}
