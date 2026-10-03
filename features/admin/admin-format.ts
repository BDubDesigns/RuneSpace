import { getLocation, LOCATIONS } from "@/game/content/locations";
import { skillLevelThresholds } from "@/game/config/balance";
import { getSkillPresentation } from "@/game/content/skill-presentation";
import { presentedSkills } from "@/game/domain/character-progression";
import { getItemPresentation } from "@/game/content/item-presentation";
import { getMission } from "@/game/content/missions";
import {
  APPEAL_OUTCOME_LABEL,
  MODERATION_CASE_STATUS_LABEL,
  MODERATION_RULE_LABEL,
  SANCTION_DURATION_LABEL,
  SANCTION_KIND_LABEL,
} from "@/game/domain/moderation";

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

/** Domain label for a moderation token, falling back to the raw token. */
function labelOf(labels: Record<string, string>, token: unknown): string {
  return typeof token === "string" ? (labels[token] ?? token) : "";
}

/** A sanction duration key as its label; `null` (permanent or none) is omitted by callers. */
function durationText(token: unknown): string {
  return labelOf(SANCTION_DURATION_LABEL, token);
}

/**
 * A stored ISO instant as a deterministic operator-facing UTC time
 * (`2026-09-30 14:03:05 UTC`). Deterministic on purpose: the moderation pages
 * render on the server and must not differ between server and browser.
 */
export function formatOperatorTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${date.toISOString().slice(0, 19).replace("T", " ")} UTC`;
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
    case "stop_current_action": {
      const action = str(d.actionId);
      return action
        ? `Stopped the in-progress "${action}" action.`
        : "Stopped the in-progress action.";
    }
    case "teleport_character": {
      const from = locationLabel(str(d.fromLocationId));
      const to = locationLabel(str(d.toLocationId));
      const interruptedAction = str(d.interruptedActionId);
      const interrupted = interruptedAction ? ` (interrupted "${interruptedAction}")` : "";
      return `Teleported ${from || "unknown"} → ${to || "unknown"}${interrupted}.`;
    }
    case "removed_stack_quantity": {
      const n = num(d.removedQuantity);
      const from = d.source === "cargo" ? "the Cargo hold" : "carried inventory";
      // New rows carry the removed stack's itemId; legacy rows without it keep
      // the generic summary.
      const item = itemLabel(str(d.itemId));
      if (d.mode === "stack") {
        const count = n !== undefined ? ` (${n} ${n === 1 ? "item" : "items"})` : "";
        return item
          ? `Removed the whole ${item} stack from ${from}${count}.`
          : `Removed the whole stack from ${from}${count}.`;
      }
      return item ? `Removed 1 ${item} from ${from}.` : `Removed 1 item from ${from}.`;
    }
    case "force_unequipped_item": {
      const slot = suitSlotLabel(str(d.suitSlotId));
      const where = slot ? ` from ${slot}` : "";
      // New rows carry the unequipped instance's itemId; legacy rows without
      // it keep the generic summary.
      const item = itemLabel(str(d.itemId));
      return item ? `Force-unequipped ${item}${where}.` : `Force-unequipped an item${where}.`;
    }
    case "removed_unique_item": {
      const item = itemLabel(str(d.itemId));
      const from =
        d.source === "cargo"
          ? "the Cargo hold"
          : d.source === "site_stash"
            ? "a site stash"
            : "carried inventory";
      return `Permanently deleted unique ${item || "item"} from ${from}.`;
    }
    case "added_stackable_item": {
      const n = num(d.quantity);
      const item = itemLabel(targetIdentity ?? "");
      // The seam always records the itemId as the target identity; the fallback
      // keeps the summary honest if a row ever lacked it.
      return item
        ? `Added ${n ?? 1} × ${item} to carried inventory.`
        : `Added ${n ?? 1} item(s) to carried inventory.`;
    }
    case "added_unique_item": {
      const item = itemLabel(str(d.itemId));
      const charge = num(d.currentCharge);
      return `Added unique ${item || "an item"} to carried inventory${
        charge !== undefined ? ` (charge ${charge})` : ""
      }.`;
    }
    case "reset_mission_chain": {
      const n = ids(d.deletedMissionIds).length;
      const root = missionLabel(targetIdentity ?? "");
      return root
        ? `Reset the mission chain rooted at ${root}: cleared ${n} row(s).`
        : `Reset the mission chain: cleared ${n} row(s).`;
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
    // Issue #223 — account and system access operations.
    case "grant_early_access":
      return "Granted Early Access to this account.";
    case "revoke_early_access":
      return "Revoked Early Access for this account.";
    case "open_public_gameplay":
      return "Opened public gameplay.";
    case "close_public_gameplay":
      return "Closed public gameplay.";
    // Issue #248 — moderation operations.
    case "open_moderation_case": {
      const reason = str(d.reason);
      return reason ? `Opened the case. Reason: "${reason}"` : "Opened the case.";
    }
    case "set_moderation_case_status": {
      const from = labelOf(MODERATION_CASE_STATUS_LABEL, d.from);
      const to = labelOf(MODERATION_CASE_STATUS_LABEL, d.to);
      return from && to ? `Set case status ${from} → ${to}.` : "Set the case status.";
    }
    case "add_moderation_case_note":
      return "Added a case note.";
    case "issue_moderation_sanction": {
      const kind = labelOf(SANCTION_KIND_LABEL, d.kind) || "sanction";
      const reference = str(d.reference);
      const facts = [
        labelOf(MODERATION_RULE_LABEL, d.ruleCategory),
        durationText(d.duration),
        str(d.endsAt) ? `ends ${formatOperatorTime(str(d.endsAt))}` : "",
      ].filter(Boolean);
      const caseStatus = d.caseStatus as { from?: unknown; to?: unknown } | undefined;
      const from = labelOf(MODERATION_CASE_STATUS_LABEL, caseStatus?.from);
      const to = labelOf(MODERATION_CASE_STATUS_LABEL, caseStatus?.to);
      return `Issued ${kind}${reference ? ` on ${reference}` : ""}${
        facts.length > 0 ? ` (${facts.join(", ")})` : ""
      }${from && to ? `; case ${from} → ${to}` : ""}.`;
    }
    case "change_moderation_sanction_duration": {
      const kind = labelOf(SANCTION_KIND_LABEL, d.kind) || "sanction";
      const duration = d.duration as { from?: unknown; to?: unknown } | undefined;
      const endsAt = d.endsAt as { from?: unknown; to?: unknown } | undefined;
      const from = durationText(duration?.from) || "no duration";
      const to = durationText(duration?.to) || "no duration";
      const ends = (value: unknown) =>
        typeof value === "string" ? formatOperatorTime(value) : "never";
      return `Changed ${kind} duration ${from} → ${to} (ends ${ends(endsAt?.from)} → ${ends(
        endsAt?.to,
      )})${d.appealId ? " while deciding an appeal" : ""}.`;
    }
    case "reverse_moderation_sanction": {
      const kind = labelOf(SANCTION_KIND_LABEL, d.kind) || "sanction";
      const rule = labelOf(MODERATION_RULE_LABEL, d.ruleCategory);
      return `Reversed ${kind}${rule ? ` (${rule})` : ""}${
        d.appealId ? " while deciding an appeal" : ""
      }.`;
    }
    case "decide_moderation_appeal": {
      const outcome = labelOf(APPEAL_OUTCOME_LABEL, d.outcome) || "Decided";
      const duration = durationText(d.duration);
      return `Decided an appeal: ${outcome}${duration ? ` (new duration ${duration})` : ""}${
        d.hasNote ? ", with an internal note" : ""
      }.`;
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
 * The skills the operator console can SET TOTAL XP on: exactly the skills the
 * Character surface presents (`presentedSkills` — an approved curve AND
 * canonical presentation), in the same order. Never listed here, so a future
 * approved skill appears with no edit and a skill without a curve (Strength)
 * is absent. The command still validates the curve server-side, so this list
 * is presentation only.
 */
export function xpSettableSkills(): readonly { skillId: string; displayName: string }[] {
  return presentedSkills({
    levelThresholds: skillLevelThresholds,
    skillDisplayName: (skillId) => getSkillPresentation(skillId)?.displayName,
  });
}

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
