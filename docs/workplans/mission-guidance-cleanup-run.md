# Mission-guidance cleanup — overnight run ledger (#176)

Durable execution ledger for orchestration issue #176. The refreshed bodies of
#173, #143, and #174 remain authoritative for product requirements; this file
records execution state only, so a fresh session can reconstruct the run.

## Scope

- Orchestration issue: #176.
- Ordered slices (strictly sequential): **#173 → #143 → #174**.
- Shared semantic contract: **blue = Mission conversation boundary** (unaccepted
  available Mission, local discovery only at the offering NPC; or turn-in phase
  once every authored requirement is satisfied, even when remote); **green =
  accepted Mission work**. Available and turn-in stay distinct domain states
  despite sharing blue. Ambiguous multi-source requirements never invent a
  destination. Semantic state is never inferred from CSS color.
- Hard boundary: nothing merges to `main`. Per-issue work merges into the staging
  branch only. At the end, one **draft** PR `staging → main` is opened for
  Brandon's preview review (approved by Brandon on 2026-09-12; he merges after
  review, not the agent).
- Issues stay open after landing on staging (landing on staging is not shipping).
- Brandon approved (2026-09-12): Wiki/Updates edits in the slice that changes the
  player-facing fact; `.qcfailed/status.json` is left untouched overnight.

## Base

| Item | Value |
| --- | --- |
| Verified starting `origin/main` | `caed481a59c30100fb40ea6c4c0f9b0e4850dbe9` (merge of PR #171) — matched the kickoff SHA exactly |
| Staging branch | `staging/mission-guidance-cleanup` (created from `caed481`) |
| Host | Brandon's home host; `./scripts/managed-host-run.sh` with private `dev.env`, local Docker Postgres, Node 22.23.2, pnpm 9.15.4 |

## Slice status

| Slice | Branch | Staging SHA before | PR | Staging SHA after | Status |
| --- | --- | --- | --- | --- | --- |
| #173 | `issue-173-bevel-focus-visible` | (ledger commit) | — | — | in progress |
| #143 | — | — | — | — | pending |
| #174 | — | — | — | — | pending |

Final combined staging SHA: _pending_.

---

## #173 — visible focus-visible rings on beveled controls

### Findings (read-only inspection)

- `.rs-bevel` (`app/globals.css`) clips with a chamfer polygon inset by
  `--rs-bevel-small` (0.4rem). `.rs-focus:focus-visible` draws a 2px outline at
  `outline-offset: 3px` — entirely outside the polygon, so it never paints.
- `.rs-bevel.rs-mission-guidance` / `.rs-bevel.rs-mission-available` also set
  `outline: none` and come later in the file with equal specificity, so a guided
  beveled control lost the (already invisible) focus outline too.
- Real `rs-bevel` + `rs-focus` focusable consumers: `ActionButton`, `ActionLink`
  (and therefore `MissionActionButton`, `MissionActionLink`), `FormField` input,
  `PlayFooterNav` destinations, `CollapseButton`, `LocationPopulationPanel`
  trigger. All inherit one shared CSS rule, so the fix belongs there.
- Mission guidance on beveled controls = 2px inset box-shadow ring at the
  padding edge + inset glow, plus the unclipped `.rs-control-halo` exterior
  drop-shadow (#171).

### Plan / checkpoint

1. One shared rule: `.rs-bevel.rs-focus:focus-visible` keeps the 2px
   `--rs-focus-ring` outline but moves it **inside** the control with a negative
   `outline-offset`, far enough in that the whole rectangle clears the chamfer
   (so the ring is uncut) and leaves a visible gap inside the Mission inset ring.
   Outline (not box-shadow) so it composes with the Mission inset box-shadow and
   survives forced-colors. Specificity (0,3,0) beats the Mission `outline: none`.
2. No markup, sizing, bevel, or Mission color changes.
3. Regression: a shared E2E fixture that proves focus **paints** by diffing
   real element screenshots (unfocused vs keyboard-focused, and pointer-focused
   vs unfocused), decoded in-browser via canvas — no new dependency. Wired into
   canonical specs: unguided `ActionLink` + unguided `ActionButton`
   (holo-hollow), green `MissionActionLink` Enter (holo-hollow, 390px and
   desktop), blue `MissionActionButton` Talk + pointer check (walk-it-off),
   green `MissionActionButton` Talk (walk-it-off).
4. Docs: `docs/design-system.md` accessibility/bevel note.

### Execution log

- _pending_
