# Item & recipe authoring — agent checklist

Start with [AGENTS.md](../AGENTS.md) and the approved issue. Use [`game/config/balance.ts`](../game/config/balance.ts) as the source of actual values; this is a locator, not a second rules document.

| You're adding… | Required | Only if relevant |
| --- | --- | --- |
| **Inventory item** | `ITEM_IDS`, balance item schema **and** defaults, Wiki category, item presentation | Approved art, equipment/charge/use fields, acquisition sources |
| **Fabrication/Refining recipe** for existing items | Recipe `ACTION_IDS`, balance recipe schema **and** defaults | Tinkering, station/location changes if explicitly approved |
| **Runeworking recipe** (#391) | Recipe `ACTION_IDS`, `balance.runeworking.recipes` schema **and** defaults, the action in Hilltop Workshop's `availableActionIds` | Nothing else: the Rig, runs, Sources, Wiki and unlock notices derive from the registry |
| **Item + recipe** | Both rows above | No third catalog |
| **New source** for an existing item | Author the real Mining/merchant/Mission/etc. source | Source action/location/gates; **no new item definition** |

## New item

- [ ] **Required:** Add a stable `ITEM_IDS` entry in [`game/config/foundations.ts`](../game/config/foundations.ts). Treat IDs as durable; change display text separately.
- [ ] **Required:** Add both a typed entry in `balanceSchema.items` **and** authored values in `defaults.items` in [`game/config/balance.ts`](../game/config/balance.ts). Follow an existing stack (`stackLimit`) or unique-item example; author `massGrams` and only applicable equipment, charge, capacity, or use fields. `getItemDefinition()` / `inventoryItemDefinitions()` derive shipped inventory from these entries; `ITEM_IDS` alone is insufficient.
- [ ] **Required:** Classify each shipped item exactly once in [`game/content/item-categories.ts`](../game/content/item-categories.ts), enforced by `validateItemCategories()`. Add its singular/plural labels, description if authored, accessible visual facts, text fallback, and available runtime art path to [`game/content/item-presentation.ts`](../game/content/item-presentation.ts). Do not restate balance in the copy.
- [ ] **Conditional — approved art:** Keep approved source masters in [`assets/item-art/`](../assets/item-art/), optimized runtime derivatives in [`public/item-art/`](../public/item-art/), and verify the small-inventory-size read per the [art cookbook](art-cookbook.md). **Never invent or regenerate owner-approved art**; raise missing approval.
- [ ] **Conditional — acquisition/use:** Author an actual Mining source (balance mining schema/defaults and location action), [merchant](../game/content/merchants.ts), [Mission](../game/content/missions.ts), [scavenge](../game/content/scavenge.ts), etc. only when that is the change. Recipes already contribute an acquisition source. For narrative work, follow the existing [Mission](missions.md), [conversation](npc-conversations.md), and [NPC canon](npc-canon.md) guides; don't duplicate them here.

## Fabrication / Refining recipe

- [ ] **Required:** Give every new recipe its own stable `ACTION_IDS` entry in [`foundations.ts`](../game/config/foundations.ts), even if it makes an existing item. The action identifies an in-progress recipe across refresh/resolution.
- [ ] **Required:** Add its typed entry under `balanceSchema.fabrication.recipes` or `balanceSchema.refining.recipes` **and** the matching `defaults` entry in [`balance.ts`](../game/config/balance.ts). Check output/item IDs, quantities and ingredients, `minimumLevel`, attempt ticks and XP; Refining additionally authors a success curve or deterministic outcome and the applicable failure kind (`fixed_outputs` / `one_input_returned` / `none`). `fabricationRecipes()` / `refiningRecipes()` expose authored recipes in order.
- [ ] **Verify distinct gates:** Personal skill `minimumLevel` does **not** grant station access. The existing Processing Yard Refining console is hosted by `ACTION_IDS.refining` in [`game/content/locations.ts`](../game/content/locations.ts)—**not** by listing every recipe's action. Rusk Recovery Fabrication station placement and its Mission-acceptance unlock are owned by [`game/content/rusk-recovery.ts`](../game/content/rusk-recovery.ts). No new station wiring for an ordinary recipe.
- [ ] **Conditional — Tinkering:** Add a target and action ID to `balanceSchema.tinkering.targets` and `defaults.tinkering.targets` **only** when approved; Fabrication output does not automatically become a Tinkering target. Manual Override is shared Fabrication behavior, not a per-recipe registration.
- [ ] **Read-only boundaries for normal content:** [Fabrication domain](../game/domain/fabrication.ts), [Refining domain](../game/domain/refining.ts), [recipe unlocks](../game/domain/recipe-unlocks.ts), and server [Fabrication](../server/fabrication-commands.ts) / [Refining](../server/refining-commands.ts) commands already enforce access, selection, bounded runs, resolution and capacity. Check input consumption, slot/mass preflight, success/failure/XP, and concurrent/replayed commands; **don't move rules into React or duplicate recipe catalogs**.
- [ ] **Failure/Auto-discard trap:** Returned ingredients in Refining `fixed_outputs` aren't byproducts; `partitionFailureAwards()` in [`game/domain/refining.ts`](../game/domain/refining.ts) classifies returned vs made outputs. The shared Refining preflight and Auto-discard Slag logic protect capacity and returns. Verify both possible outcomes, especially at full inventory. Do not reimplement this in Wiki or UI.

## Runeworking recipe (#391)

- [ ] **Required:** A stable `ACTION_IDS` entry, then a typed entry under `balanceSchema.runeworking.recipes` **and** the matching `defaults` entry: output item and quantity, inputs, `minimumLevel`, `durationTicks` and `baseXp`. Every cycle succeeds; there is no failure kind, chance curve, byproduct or Manual Override to author. `runeworkingRecipes()` exposes them in order.
- [ ] **Required:** Add the action to Hilltop Workshop's `availableActionIds` in [`game/content/locations.ts`](../game/content/locations.ts), so location guidance and item Sources find the Rig. The Rig's unlock (Not From Around Here's completion) is owned by [`game/content/hilltop-workshop.ts`](../game/content/hilltop-workshop.ts).
- [ ] **Read-only boundaries:** [Runeworking domain](../game/domain/runeworking.ts) and server [Runeworking](../server/runeworking.ts) / [commands](../server/runeworking-commands.ts) already enforce access, level, bounded runs, the single-cycle reservation, post-cycle capacity and tracked Mission credit. `validateRuneworkingRecipes` checks the recipe at module load.

## Already derived — don't add copied entries

- [`game/domain/item-sources.ts`](../game/domain/item-sources.ts) gives **character-aware repeatable** acquisition from canonical registries; one-time Mission rewards are deliberately excluded.
- [`game/domain/item-reference.ts`](../game/domain/item-reference.ts) builds **public/spoiler-complete** sources, one-time Mission rewards, byproducts, recipe inputs/outputs and item properties. [`features/public-site/public-item-wiki.ts`](../features/public-site/public-item-wiki.ts) generates `/wiki/items` from `inventoryItemDefinitions()` and the category map, not separate articles or hard-coded recipes. See [public Wiki policy](public-wiki.md).
- A Mission counting crafts of one recipe can show that recipe's output Sources with `presentsOutputSources` ([missions](missions.md), "Item sources in the Mission Log"); the output is derived from the action, never authored on the Mission.
- [`game/domain/recipe-unlocks.ts`](../game/domain/recipe-unlocks.ts) derives notices from recipe registries and `minimumLevel`: **no hand-maintained unlock list**.

## Focused review sweep

- [ ] **Items/sources:** Representation, artwork, storage/trade, equipment and charge/use if applicable; start with `tests/unit/item-definition.test.ts`, `item-presentation.test.ts`, `item-transferability.test.ts`, `item-sources.test.ts`, `public-item-wiki.test.ts` and tests for any merchant/Mission source touched.
- [ ] **Recipes:** Check skill and station gates, unlock notice order, bounded selection, preflight/slot/mass safety, settlements/failure returns, Auto-discard, and concurrency/idempotence where applicable. Inspect `tests/unit/recipe-unlocks.test.ts`, `deep-jag.test.ts`, `fabrication.test.ts`, `refining-domain.test.ts`; `tests/integration/recipe-unlock-notices.test.ts`; `tests/e2e/fabrication-advanced.spec.ts`; and feature-specific suites.
- [ ] **Registry assertions:** Some tests *intentionally* assert exact recipe order/membership/count. Update those for newly authored entries; diagnose unrelated list-size checks before touching them. Neither blanket-replace counts nor opportunistically refactor brittle tests.
- [ ] **Docs/tests:** Update [game rules](game-rules.md), [gameplay foundations](gameplay-foundations.md), editorial [Wiki](public-wiki.md) or [public Updates](public-updates.md) only where changed player-facing facts warrant, per [AGENTS.md](../AGENTS.md). Run relevant focused tests, `pnpm typecheck` / `pnpm format:check` when available, then use PR CI for the full suite. See [testing strategy](testing-strategy.md) and [development workflow](development-workflow.md). Report checks not run.

### Example: shipped Fuel Manufacturing [#343 / PR #346](https://github.com/BDubDesigns/RuneSpace/pull/346)

The empty/full canisters added item IDs, balance schema/defaults, Wiki categories, presentation, approved art masters and runtime WebPs. Fabrication and Refining each added an action ID and recipe schema/defaults; neither needed a new station. The Refining `fixed_outputs` returns Oil Shale and the empty shell on failure; the shared Refining rules protect those returns from Auto-discard. The empty canister was **not** added to Tinkering. The item Wiki and recipe-unlock notices followed automatically. **Use this to locate owners, not copy fuel-specific balance.**

## Lapidary recipes (#431)

The shipped Lapidary registry in balance owns Shape Stone (deliberately no output)
Cut Quartz, Cut Topaz and Cut Sapphire (#433). Stable action IDs, whole-tick duration, level, XP and inputs are
required. A producing recipe also authors the stack output and quantity. The
shared deterministic craft validator checks stack inputs/outputs; no failure
or Manual Override data exists. Register a recipe's action at Werner's Lab.
Sources, public item recipes and unlock notices derive from the registry;
practice is a Stone use rather than an invented output. Supervision/permission
belongs to the activity policy, not an item or recipe's personal-level gate.
