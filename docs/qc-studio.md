# QC Studio

QC Studio is a reusable visual game-content authoring environment incubating
inside RuneSpace. V1 contains one module: Dialogue. It is authoring data, not
authoritative RuneSpace content, player functionality, or a publishing system.

## Run it

The server-side `QC_STUDIO_ENABLED=true` flag is the single availability
boundary for `/qc-studio`. When it is unset or false — in any environment,
including production-mode builds — the route returns not found. There is no
separate development-only prohibition anymore: a production-mode deployment
(Coolify PR preview or live) that sets the flag serves the Studio.

- Local launch (sets the flag and the stable Studio port for you):

```bash
pnpm studio
```

Open [http://localhost:3301/qc-studio](http://localhost:3301/qc-studio).

- Deployed review: Coolify preview apps inherit the parent application's
  environment variables, so if `QC_STUDIO_ENABLED=true` is set on the RuneSpace
  app, every `pr-<N>.runespace.qcfailed.com` preview and the live deployment
  expose `/qc-studio` at `https://<host>/qc-studio`. If a deployment lacks the
  flag, apply the one-time environment setting in Coolify and redeploy; no code
  change is required.
- The route is never linked from player navigation and is served with
  `noindex, nofollow` metadata. Public access to this flagged, unlinked route
  is acceptable because the Studio is browser-local authoring with no
  source-writing, publishing, gameplay-mutation, or database-mutation
  capability. Any future feature that changes that must design its
  authorization model separately before exposure.
- Where the deployed flag cannot be applied, `pnpm studio` remains the local
  fallback visual-review path.

For lower-level debugging, the equivalent command is:

```bash
QC_STUDIO_ENABLED=true pnpm dev -- --port 3301
```

Dedicated checks are separate from the expensive canonical gameplay browser
suite:

```bash
pnpm test:studio
QC_STUDIO_ENABLED=true pnpm test:e2e:studio
```

The browser command uses the normal disposable local database wrapper only to
boot the RuneSpace runtime; QC Studio itself does not read or write gameplay
state.

## V1 workflow

The Dialogue module can load any sequence exposed by the RuneSpace adapter as a
new editable draft, or create a blank temporary draft. It supports speaker,
valid speaker-specific expression, background, local/comms mode, and text
editing; beat add, duplicate, delete, and keyboard-accessible up/down reorder;
direct beat inspection and sequential preview; action-affordance preview;
Undo/Redo; and Reset to Source.

### Item presentation beats (schema v2)

A dialogue beat presents exactly one visual subject over the authored
conversation background:

- **NPC beat** — speaker portrait + expression (existing behavior).
- **Item beat** — item artwork presented prominently in the scene with no NPC
  portrait. The panel shows a generic `Item` eyebrow (item beats are
  presentation-only and do not imply acquisition) plus the authoritative
  display name and quantity (`×N` when greater than 1).

Item beats are **presentation only**. Authoring, previewing, or exporting an
item beat is never authorization to grant, remove, consume, or otherwise mutate
inventory; RuneSpace's server-authoritative mission/reward code remains solely
responsible for all item ownership changes. The Studio UI states this
explicitly and offers no "give item" affordance.

The item dropdown lists only items from the adapter's canonical inventory
definitions — never a duplicated UI list. Quantity is constrained by the
authoritative item definition: stackable items accept integers from `1`
through their `stackLimit`; unique items are locked to `1`. Switching items
re-clamps quantity into the newly selected item's range. Unknown IDs or
out-of-range quantities fail validation and block preview/export.

Existing NPC-only drafts keep working: schema v1 local drafts are migrated
in place to v2 (every existing beat becomes an NPC beat), and unknown future
versions still fail safely untouched.

Drafts are stored in browser `localStorage` under an adapter-scoped,
versioned envelope (`…:dialogue:v2`). Text changes autosave after a short idle
debounce and structural changes save immediately. The UI reports the save state.
Session Undo/Redo is in memory, and the five newest durable complete snapshots
can be inspected and restored.

`Copy for RuneSpace` produces a structured export containing the adapter,
source sequence identity or new-draft context, sequence metadata, action, and
every beat — including each item beat's deterministic `itemId` and `quantity`.
It does not write source files, register stable IDs, create commits, or publish
content. A developer or agent applies the reviewed export to typed RuneSpace
content through the normal repository and PR workflow.

## Applying QC Studio exports

A QC Studio Dialogue export is approved authoring input for a human-reviewed
repository change. It is not executable code, a source-file patch, or a publish
command. The current V1 shape is:

```json
{
  "qcStudio": {
    "schemaVersion": 2,
    "module": "dialogue",
    "adapterId": "runespace"
  },
  "source": {
    "kind": "authoritative_sequence",
    "sequenceId": "..."
  },
  "sequence": {
    "title": "...",
    "npcId": "...",
    "beats": [],
    "action": "..."
  }
}
```

### Export identity

- `qcStudio.schemaVersion` identifies the QC Studio export schema.
- `qcStudio.module` identifies the authoring module. V1 supports `dialogue`.
- `qcStudio.adapterId` identifies the target game adapter. For RuneSpace it
  must be `runespace`.
- Reject the export or stop for review when the schema, module, or adapter
  combination is unsupported. Do not guess what an unsupported value means.

### Source semantics

For `source.kind: "authoritative_sequence"`:

- Update the existing authoritative RuneSpace dialogue identified by
  `source.sequenceId`.
- Locate that exact stable dialogue ID in the current repository before editing.
- Treat the exported sequence content as the approved replacement authoring
  content for that sequence, while preserving unrelated dialogue and gameplay
  behavior.
- Do not create a second dialogue sequence or a new stable ID.
- If the referenced sequence cannot be found, stop and report the mismatch
  instead of silently creating content.

For `source.kind: "new_draft"`:

- The export represents dialogue that does not yet exist authoritatively.
- When present, `source.proposedStableId` is a proposed ID, not an automatic
  registration. Validate it against the target repository's current stable-ID
  and content conventions before using it.
- If no stable ID is supplied and choosing one would require a product or
  content decision, stop rather than inventing one silently.
- Register new content only through the repository's existing authoritative
  content organization and stable-ID patterns.

### Sequence and beat semantics

- `sequence.title` is Studio/editor metadata. It is not automatically a
  RuneSpace runtime field. If the authoritative RuneSpace type has no title,
  do not add a production field merely to preserve it.
- `sequence.npcId` identifies the sequence's primary or context NPC. Validate it
  against the current RuneSpace NPC catalog; do not invent an NPC for an
  unknown ID.
- `sequence.beats` is ordered approved authoring content. Each beat carries a
  `kind` discriminator:
  - `kind: "npc"` — approved `speakerNpcId`, `expressionId`, `backgroundId`,
    `presentationMode`, and `text`.
  - `kind: "item"` — approved `itemId`, `quantity`, `backgroundId`, and an
    optional caption `text`. The `itemId` must exist in the target
    repository's canonical inventory definitions and the quantity must be
    within that item's authoritative range (`1..stackLimit` for stacks, exactly
    `1` for unique items).
- An item beat's `itemId`/`quantity` describe **presentation only**. Applying
  an export never authorizes item-granting gameplay code; reward/ownership
  changes require a separate approved issue and stay in RuneSpace's
  server-authoritative mission code.
- Preserve beat order exactly unless the creator explicitly requests a reorder.
  Validate every NPC, expression, background, item ID, and quantity against
  current authored RuneSpace content.
- Do not rewrite approved dialogue copy for style, grammar, or preference
  unless the creator explicitly asks for that change.
- Preserve `sequence.action` when supplied, including existing actions such as
  `accept_mission` or `complete_mission`. Do not infer additional quest or
  gameplay behavior from dialogue.
- Changing dialogue through QC Studio must not accidentally change mission
  mechanics, rewards, persistence, or progression unless the export or request
  explicitly calls for that separate change.

### Preserve RuneSpace's native representation

QC Studio exports a neutral authoring representation. They do not dictate how
RuneSpace source code is formatted or organized. Translate the normalized
Studio content back into the repository's existing native typed representation.
For example, when the repository uses:

```ts
wadeLocal(EXPRESSION_IDS.concerned, "You're alive.")
```

preserve that helper and typed-ID pattern instead of replacing the content file
with generic JSON objects. Preserve existing typed IDs, dialogue helper
functions, SSOT/content organization, and formatting/style conventions. Do not
restructure the dialogue content model merely because the export uses
normalized JSON.

### Safe application workflow

```text
receive QC Studio export
  → validate schema, module, and adapter
  → inspect the current authoritative target
  → resolve source identity
  → validate NPC, expression, background, and action IDs
  → apply only the exported content through native RuneSpace patterns
  → run relevant validation and tests
  → follow the normal PR and human-review workflow
```

Agents must inspect the current repository rather than blindly string-replacing
source. Source control and normal RuneSpace review remain authoritative. An
export never means publish automatically.

## Architecture boundary

```text
QC Studio core
    ↓
Dialogue module
    ↓
RuneSpace adapter
    ↓
RuneSpace content + production dialogue presentation
```

The framework-free core owns neutral draft, validation, history, storage, and
export contracts. The adapter translates RuneSpace NPCs, authored expressions,
conversation backgrounds, and dialogue sequences without putting RuneSpace
content into the generic core. The preview bridge renders the shared production
`DialogueScene`; it does not approximate or fork `DialoguePlayer`'s visual
scene.

The first version intentionally has no plugin loader, second game contract,
database persistence, cloud sync, authentication/admin role, AI authoring,
branching DSL, source mutation, or separate repository/package. A second
substantial Studio module or a real second game consumer should provide the
evidence for future extraction and shared-module design.
