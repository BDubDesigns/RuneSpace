# QC Studio

QC Studio is a reusable visual game-content authoring environment incubating
inside RuneSpace. V1 contains one module: Dialogue. It is authoring data, not
authoritative RuneSpace content, player functionality, or a publishing system.

## Run it

QC Studio is available only in a non-production Next.js process. The primary
local launch command enables the development flag and uses the stable Studio
port for you:

```bash
pnpm studio
```

Open [http://localhost:3301/qc-studio](http://localhost:3301/qc-studio). The
route is not linked from player navigation. It returns not found when the flag
is absent and remains unavailable when `NODE_ENV=production`, even if an
environment contains the flag. The normal Coolify PR preview is therefore not
the QC Studio visual-review surface; product-owner Studio review is performed
locally with `pnpm studio`. A PR preview may still verify that RuneSpace
gameplay remains unaffected.

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

Drafts are stored in browser `localStorage` under an adapter-scoped, versioned
V1 envelope. Text changes autosave after a short idle debounce and structural
changes save immediately. The UI reports the save state. Session Undo/Redo is
in memory, and the five newest durable complete snapshots can be inspected and
restored. Unknown future schema versions are left untouched and fail safely to
a fresh draft; export is the safe way to preserve work made in that session.

`Copy for RuneSpace` produces a structured export containing the adapter, source
sequence identity or new-draft context, sequence metadata, action, and every
beat. It does not write source files, register stable IDs, create commits, or
publish content. A developer or agent applies the reviewed export to typed
RuneSpace content through the normal repository and PR workflow.

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
