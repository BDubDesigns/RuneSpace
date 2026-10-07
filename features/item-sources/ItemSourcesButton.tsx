"use client";

import { useRef, useState } from "react";
import { itemSourceFactsFromState } from "./item-source-facts";
import { itemName } from "./item-source-presentation";
import { ItemSourcesDrawer } from "./ItemSourcesDrawer";

/**
 * The compact "Sources" affordance for one item (#326): a small text button
 * that opens the shared item-source details. Owns only whether they are open;
 * a surface adds it beside any item it names and passes the Play state, from which
 * the character's facts are read only when the details open.
 */
export function ItemSourcesButton({
  itemId,
  state,
}: {
  itemId: string;
  state: Parameters<typeof itemSourceFactsFromState>[0];
}) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const name = itemName(itemId);
  return (
    <>
      <button
        aria-haspopup="dialog"
        aria-label={`How to get ${name}`}
        className="rs-focus inline-flex min-h-[var(--rs-touch-target)] items-center px-2 text-xs font-semibold uppercase tracking-wide text-[color:var(--rs-accent-primary)] underline-offset-2 hover:underline"
        data-item-sources-trigger={itemId}
        onClick={() => setOpen(true)}
        ref={triggerRef}
        type="button"
      >
        Sources
      </button>
      {open ? (
        <ItemSourcesDrawer
          facts={itemSourceFactsFromState(state)}
          itemId={itemId}
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
        />
      ) : null}
    </>
  );
}
