"use client";

import type { ComponentProps } from "react";
import { ActionButton } from "@/components/ui/ActionButton";

/**
 * The character-wide Prioritize primary resources toggle (#342).
 *
 * Presentational only: the value is the server's per-character preference and
 * what a press does belongs to the caller. It is Off by default, and it says in
 * the control itself what turning it on costs, because a rare or even Ultra Rare
 * find that arrives with no room left is permanently forfeited, not deferred.
 * `aria-pressed` carries the state for assistive technology; the help text is
 * wired to the button with `aria-describedby`.
 */
export function PrioritizePrimaryResourcesToggle({
  prioritizePrimaryResources,
  onToggle,
  ...buttonProps
}: {
  prioritizePrimaryResources: boolean;
  onToggle: (next: boolean) => void;
} & Pick<ComponentProps<typeof ActionButton>, "disabled" | "loading">) {
  return (
    <div className="flex flex-col gap-2" data-prioritize-primary-resources>
      <div className="flex flex-wrap items-center gap-3">
        <ActionButton
          {...buttonProps}
          aria-describedby="prioritize-primary-resources-help"
          aria-pressed={prioritizePrimaryResources}
          intent={prioritizePrimaryResources ? "primary" : "secondary"}
          onClick={() => onToggle(!prioritizePrimaryResources)}
        >
          Prioritize primary resources: {prioritizePrimaryResources ? "On" : "Off"}
        </ActionButton>
      </div>
      <p
        className="text-xs text-[color:var(--rs-text-muted)]"
        data-prioritize-primary-resources-help
        id="prioritize-primary-resources-help"
      >
        {prioritizePrimaryResources
          ? "On: mining keeps ore first and carries on while there is room for one. A rare find with no room left is lost for good — even an Ultra Rare one."
          : "Off: mining stops before an attempt unless there is room for its ore and for any one rare find, so nothing is lost."}
      </p>
    </div>
  );
}
