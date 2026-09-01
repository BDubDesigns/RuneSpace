# Issue #126 pre-alpha mission reset

This is the one-time, reviewable maintenance operation for the existing
pre-alpha tester population. It clears only the canonical `walk_it_off` and
`cut_your_teeth` mission rows and canonical `salvage_cutter` unique item
instances. It deliberately does not roll back Mining XP or change unrelated
inventory, progression, character, action, location, Cargo Hold, portrait, or
Power Cell state.

The implementation is `scripts/prealpha-mission-reset.mjs`. It is not an HTTP
endpoint and it is not a general admin framework.

The PostgreSQL integration coverage for this population-wide maintenance command
is intentionally isolated from the ordinary concurrent integration suite:

```bash
pnpm run test:integration:issue-126
```

That command creates its own disposable test database, runs only the Issue #126
integration file, and drops the database afterward.

To check the documented capture and expected-report round trip without changing
the development database:

```bash
node scripts/disposable-test-db.mjs -- sh -c 'pnpm --silent run maintenance:issue-126 > /tmp/issue-126-dry-run.json && node --experimental-strip-types scripts/prealpha-mission-reset.mjs --verify --expected-report /tmp/issue-126-dry-run.json'
```

This uses a fresh empty disposable database, so verification succeeds after
consuming the captured JSON without exercising a destructive reset.

## Operator sequence

Run the default command in the intended database terminal and save its JSON
output somewhere protected for the operator review:

```bash
pnpm --silent run maintenance:issue-126 > /tmp/issue-126-dry-run.json
```

The default mode performs SELECTs only. Its report includes the affected
character IDs, target mission/item counts, unrelated inventory/item baseline,
Mining XP baseline, and unsafe states. An active action or a Salvage Cutter in
Cargo Hold makes the report unsafe; execution must be investigated and refused
until a fresh safe report exists.

After the product owner has reviewed the counts, execute only with the exact
reviewed report and confirmation token:

```bash
node --experimental-strip-types scripts/prealpha-mission-reset.mjs \
  --execute \
  --confirm ISSUE-126-RESET \
  --expected-report /tmp/issue-126-dry-run.json
```

Execution locks the account/character population, re-runs the dry-run scan,
and aborts without writes if the reviewed counts, population, unsafe-state
report, Mining XP baseline, or unrelated-state fingerprint changed. It then
runs verification inside the same serializable transaction before committing
and once again after commit. Equipment assignments referencing a Salvage
Cutter are deleted before the Cutter instances; mission rows are deleted in
that same transaction.

For a read-only verification retry using the saved reviewed report:

```bash
node --experimental-strip-types scripts/prealpha-mission-reset.mjs \
  --verify \
  --expected-report /tmp/issue-126-dry-run.json
```

Verification is successful only when the reset population is still present,
both target mission-row counts are zero, Salvage Cutter assignments and
instances are zero, unrelated inventory/item counts and state are unchanged,
and every recorded Mining XP total is unchanged.

This operation must not be run by CI or automatically by an implementation
agent. It must not be pointed at production until the sequencing gates in
Issue #126 are complete and the product owner explicitly authorizes the
destructive command after reviewing the dry-run report. Never replace the
canonical IDs with display names or ad-hoc SQL.
