# Issue #68 — Inventory equip + compact selected-item visual

## Outcome
- Repair the two remaining Inventory UX gaps: keep the selected-item visual
  compact on narrow portrait phones, and let a carried, authoritatively
  eligible Salvage Cutter be equipped directly from Inventory details.
- Reuse the authoritative equipment command and `eligibleItems` projection;
  do not add new rules, migrations, or a generic action framework.

## Current evidence (verified on `origin/main` @ 0ef0725)
- `features/mining/InventoryPanel.tsx`: the selected visual uses
  `className="h-28 self-start"`. The details grid is
  `grid items-start gap-3 sm:grid-cols-[7rem_minmax(0,1fr)]`; below `sm` the
  single column lets the `h-28` visual stretch across the dossier width even
  though the artwork is compact (issue criterion 1).
- `features/mining/EquipmentPanel.tsx`: equip/unequip submit inline via
  `command()`/`apply()` using the command gate, `startTransition`,
  `acceptState`, and `releaseCommand`. The same submission/reconciliation
  pattern is needed for Inventory Equip, which would otherwise duplicate it.
- `features/mining/useLoadPowerCell.ts`: the established narrow shared hook
  pattern (command acquisition + uncertain-transport + authoritative accept +
  status mapping in one place) that Inventory and Equipment already share.
- `server/mining.ts` (lines ~1122-1133): `equipment.slots[]` exposes an
  authoritative `eligibleItems` projection — non-equipped instances compatible
  with the slot. This is the single source of truth for equip-eligibility; the
  client must derive from it, not from a hardcoded item-name rule. Cargo-held
  items are excluded by the server projection, so the client needs no
  Cargo-specific logic.
- `features/mining/MiningPlayContext.tsx`: the `enqueueForeground` /
  `releaseCommand` command gate already serializes foreground commands and
  handles uncertain-transport pending state.

## Plan (right-sized, no new subsystem)
1. **Compact visual (InventoryPanel):** change the selected
   `ItemVisual`/`InventoryStackVisual` class from `h-28 self-start` to
   `h-28 w-28 self-start`. `w-28 = 7rem` matches the existing `sm+` column
   exactly, so narrow portrait shows the same compact square tile; responsive
   CSS only, no duplicate portrait/landscape markup, no overflow at 390px.
2. **Pure helper (`inventory-selection.ts`):** add
   `deriveInventoryEquipAvailability(state, selection, busy)` returning
   `{enabled:true, target, itemInstanceId, slotLabel}` when the selected
   carried unique item id appears in any `equipment.slots[].eligibleItems`,
   `{enabled:false, reason:"busy"}` while a command is in flight, or
   `undefined` otherwise (ineligible / cargo-held unique items get no Equip
   action). No new compatibility rule on the client.
3. **Shared equip hook (`useEquipCommand.ts`, mirrors `useLoadPowerCell`):**
   wraps equip/unequip submission through the existing gate; on success calls
   `acceptState` + muted feedback, on refusal/error danger feedback, on
   transport error the last confirmed state is preserved (no auto-replay).
4. **EquipmentPanel:** refactor to consume `useEquipCommand`; the existing
   inline `command`/`apply` is removed. Equip/unequip success clears the status
   line (identical visible behavior).
5. **InventoryPanel Equip:** add the derived `equipAvailability`, a
   `useEquipCommand` feedback mirror, an Equip `ActionButton` in the unique-item
   details, `runEquip()` that arms a `equipReturnFocusRef` then submits; on the
   authoritative state update the equipped tile disappears, the existing
   reconcile effect clears the stale selection, and a new focus-return effect
   rests focus on the grid. Refusal/busy/pending behavior preserved.
6. **Lean tests (`tests/unit/inventory-selection.test.ts`):** Equip available
   for the authoritative-eligible selected Cutter; disabled with busy reason;
   no Equip for an item absent from every `eligibleItems`; no Equip for stack
   selections / already-cleared selection. Server compatibility stays in the
   existing equipment-command coverage.

## Validation run (local, CI-parity)
- `pnpm typecheck` — pass
- `pnpm lint` (next lint) — pass
- `pnpm format:check` — pass
- `pnpm test` — 39 files, pass
- `pnpm build` — pass (with the CI placeholder DATABASE_URL/BETTER_AUTH_SECRET,
  matching `.github/workflows/ci.yml`; no real DB connection made)
- Integration + canonical E2E: not run locally this session (require the
  disposable PostgreSQL + Playwright); to be confirmed by CI full gate / a
  follow-up local run.

## Explicit non-goals honored
No migration, new equipment rules, drag-and-drop, comparison UI, bulk actions,
item-action framework, or Inventory/Equipment redesign.