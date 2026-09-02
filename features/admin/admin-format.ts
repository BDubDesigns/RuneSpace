import { getLocation, LOCATIONS } from "@/game/content/locations";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import { getItemPresentation } from "@/game/content/item-presentation";
import { getMission } from "@/game/content/missions";
import { SKILL_IDS } from "@/game/config/foundations";

/** Human label for a canonical location id, falling back to the raw id. */
export function locationLabel(locationId: string): string {
  return getLocation(locationId)?.displayName ?? locationId;
}

/** Human label for a canonical skill id, falling back to the raw id. */
export function skillLabel(skillId: string): string {
  return getSkillPresentation(skillId)?.displayName ?? skillId;
}

/** Human label for a canonical item id, falling back to the raw id. */
export function itemLabel(itemId: string): string {
  return getItemPresentation(itemId)?.displayName ?? itemId;
}

/** Human label for a canonical mission id, falling back to the raw id. */
export function missionLabel(missionId: string): string {
  return getMission(missionId)?.title ?? missionId;
}

/** Human label for a mission state token, falling back to the raw token. */
export function missionStateLabel(state: string): string {
  switch (state) {
    case "not_accepted":
      return "not accepted";
    case "ready_for_completion":
      return "ready to complete";
    case "active":
      return "active";
    case "completed":
      return "completed";
    default:
      return state;
  }
}

/**
 * Operator audit history is persisted as structured JSON (`details`) by the
 * command boundaries. This formatter renders a concise, human-readable
 * mutation summary from those stored details, resolving canonical ids to
 * display names through the authoritative content modules. It is a pure
 * function so it can be unit-tested against every operation the seams write.
 * It never invents data the row does not carry — values the row does not store
 * are omitted rather than guessed.
 */
export type OperatorAuditView = {
  /** Concise human-readable summary of what changed. */
  summary: string;
  /** Canonical operation id (forensic). */
  operation: string;
  /** Canonical target identity when present (e.g. itemId, stackId, instanceId). */
  targetIdentity: string | null;
  /** The exact structured JSON persisted for this row (forensic disclosure). */
  details: unknown;
};

export function formatAuditSummary(
  operation: string,
  details: unknown,
  targetIdentity: string | null,
): string {
  const d = (details ?? {}) as Record<string, unknown>;
  const num = (value: unknown): number | undefined =>
    typeof value === "number" ? value : undefined;
  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  const ids = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((v) => String(v)).filter(Boolean) : [];

  switch (operation) {
    case "stop_current_action":
      return "Stopped the in-progress action.";
    case "teleport_character": {
      const from = locationLabel(str(d.fromLocationId));
      const to = locationLabel(str(d.toLocationId));
      const interrupted = d.interruptedActionId ? " (interrupted an in-flight action)" : "";
      return `Teleported ${from || "unknown"} → ${to || "unknown"}${interrupted}.`;
    }
    case "removed_stack_quantity": {
      const n = num(d.removedQuantity);
      const from = d.source === "cargo" ? "the Cargo hold" : "carried inventory";
      if (d.mode === "stack")
        return `Removed the whole stack from ${from}${n ? ` (${n} item(s))` : ""}.`;
      return `Removed 1 item from ${from}.`;
    }
    case "force_unequipped_item": {
      const slot = suitSlotLabel(str(d.suitSlotId));
      return `Force-unequipped an item${slot ? ` from ${slot}` : ""}.`;
    }
    case "removed_unique_item": {
      const item = itemLabel(str(d.itemId));
      const from = d.source === "cargo" ? "the Cargo hold" : "carried inventory";
      return `Permanently deleted unique ${item} from ${from}.`;
    }
    case "added_stackable_item": {
      const n = num(d.quantity);
      const item = itemLabel(targetIdentity ?? "");
      return `Added ${n ?? 1} × ${item} to carried inventory.`;
    }
    case "added_unique_item": {
      const item = itemLabel(str(d.itemId));
      return `Added unique ${item} to carried inventory.`;
    }
    case "reset_mission_chain": {
      const root = missionLabel(targetIdentity ?? "");
      const n = ids(d.deletedMissionIds).length;
      return `Reset the mission chain rooted at ${root}: cleared ${n} row(s).`;
    }
    case "reset_all_missions": {
      const n = ids(d.deletedMissionIds).length;
      return `Reset ALL missions for this character: cleared ${n} row(s).`;
    }
    case "set_skill_xp": {
      const skill = skillLabel(str(d.skillId));
      const before = num(d.before);
      const after = num(d.after);
      if (before !== undefined && after !== undefined)
        return `Set ${skill} total XP ${before} → ${after}.`;
      return `Set ${skill} total XP.`;
    }
    default:
      return `${operation}${targetIdentity ? ` (${targetIdentity})` : ""}.`;
  }
}

/** Suit-slot ids are canonical tokens; humanize the token for presentation. */
function suitSlotLabel(suitSlotId: string): string {
  if (!suitSlotId) return "";
  return suitSlotId.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * The rewritten skills the operator console can SET TOTAL XP on (commands
 * reject anything without an approved progression curve).
 */
export const XP_SHAPED_SKILLS = [SKILL_IDS.mining, SKILL_IDS.refining, SKILL_IDS.welding] as const;

/**
 * Canonical items the ADD ITEM control offers, with human labels for the
 * operator. Stackables and uniques are both offered; ADD ITEM validates against
 * the authoritative item definition at the command boundary. `kind` drives
 * operator UX: uniques are added exactly one-per-command (no quantity input),
 * stackables take a positive whole quantity.
 */
export const ADMIN_OFFERED_ITEMS = [
  { itemId: "ferrite_shale", label: "Ferrite Shale", kind: "stack" },
  { itemId: "refined_ferrite", label: "Refined Ferrite", kind: "stack" },
  { itemId: "slag", label: "Slag", kind: "stack" },
  { itemId: "power_cell", label: "Power Cell", kind: "stack" },
  { itemId: "salvage_cutter", label: "Salvage Cutter", kind: "unique" },
  { itemId: "mykea_schleppraum_8", label: "Mykea Schleppraum 8", kind: "unique" },
] as const;

export type AdminOfferedItem = (typeof ADMIN_OFFERED_ITEMS)[number];

/**
 * The canonical locations offered as teleport destinations. Derived directly
 * from the authoritative location registry (`LOCATIONS`), never hand-maintained
 * in this feature, so an operator can only ever be offered a location that
 * resolves canonically. The server command re-validates each destination via
 * `getLocation` under the transaction lock regardless.
 */
export const ADMIN_DESTINATIONS: readonly { locationId: string; label: string }[] = LOCATIONS.map(
  (location) => ({ locationId: location.id, label: location.displayName }),
);
