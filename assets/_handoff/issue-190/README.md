# Handoff files for #190 — Add Rusk Recovery, `10,000 Hours`, repeatable Practice Welding, and Clean Pass

**Temporary.** Staged on 2026-09-14 so a cloud session can use files that
existed only on Brandon's machine. Delete this whole folder before the PR is
marked ready.

| File | Size | What it is | Status |
| --- | --- | --- | --- |
| `rusk-recovery-asset-pack.zip` | 12.3 MB | Rusk Recovery asset pack: game-ready finals under `public/` (location scene, dialogue background, map identifier, Scrap Metal item art) plus their source masters under `masters/`. The pack's own `README.md` describes each file. | approved |

## For the session working this issue

1. These are raw source files, not runtime assets. Nothing in `app/`,
   `features/`, `game/content/`, or anywhere else may reference
   `assets/_handoff/`.
2. Extract the zip into a scratch location, not into the repo, and read its
   `rusk_recovery_asset_pack/README.md` first. The files under its `public/`
   are **already-prepared, approved finals**: place them at the matching
   runtime paths under `public/` and wire them in. Do not regenerate or
   re-prepare them. Do check them against `docs/art-cookbook.md` (naming,
   dimensions, runtime directories), and make sure any committed metadata
   describes the actual files.
3. The `masters/` files are the approved sources the finals came from. Do not
   commit them to the repo unless issue #190 or Brandon says to.
4. If the issue needs art that isn't in the pack, ask Brandon. Do not generate
   substitutes.
5. Before marking the PR ready, delete this folder in its own commit
   (`chore: remove staged handoff files for #190`), and note in the PR body
   that the branch carried staged raw files, so it should be **squash-merged**
   to keep them out of `main`'s history.
