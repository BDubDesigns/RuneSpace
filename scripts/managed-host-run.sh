#!/usr/bin/env bash
#
# managed-host-run.sh — narrow managed-host command wrapper (Issue #74).
#
# Loads the managed host's private local environment, forces the system Node 22
# (rather than a user-local Node 24), validates a localhost-only DATABASE_URL,
# and replaces this process with the requested command so exit status and
# signals propagate. This is a convenience/safety boundary for Brandon's managed
# RuneSpace host only — not a universal task runner — and it never prints the
# private environment or any credentials.
#
# It intentionally does NOT duplicate the focused/canonical E2E runners' server
# lifecycle, port selection, process cleanup, or environment maps; those remain
# authoritative in scripts/e2e-shared.mjs, run-focused-e2e.mjs, and
# run-canonical-e2e.mjs.
#
# Usage:
#   ./scripts/managed-host-run.sh pnpm test:integration
#   ./scripts/managed-host-run.sh pnpm drizzle-kit migrate
#   ./scripts/managed-host-run.sh pnpm test:e2e:canonical

set -euo pipefail

readonly PRIVATE_ENV="/home/brandon/.config/runespace/dev.env"

if [[ "$#" -eq 0 ]]; then
  printf '%s\n' \
    "managed-host-run: a command is required, e.g. ./scripts/managed-host-run.sh pnpm test:integration" >&2
  exit 64
fi

if [[ ! -f "$PRIVATE_ENV" || ! -r "$PRIVATE_ENV" ]]; then
  printf '%s\n' \
    "managed-host-run: private environment file ${PRIVATE_ENV} is missing or unreadable; cannot load the host-local DATABASE_URL." >&2
  exit 1
fi

# Load the private environment and export its assignments to the child command.
# Nothing from the file is printed, logged, echoed, or otherwise exposed.
set -a
# shellcheck disable=SC1090
source "$PRIVATE_ENV"
set +a

# Prefer the managed host's system Node 22 over any user-local Node 24. The
# `${PATH:+:$PATH}` form avoids an empty trailing PATH element.
export PATH="/usr/bin${PATH:+:$PATH}"

# process.versions.node reports "22.x.y" without the leading "v".
node_version="$(node -p 'process.versions.node')"
if [[ "$node_version" != 22.* ]]; then
  printf '%s\n' "managed-host-run: Node 22.x required, found ${node_version}" >&2
  exit 1
fi

if [[ -z "${DATABASE_URL:-}" ]]; then
  printf '%s\n' \
    "managed-host-run: DATABASE_URL is not set after loading the private environment." >&2
  exit 1
fi

# Validate that the host is localhost/127.0.0.1 without printing the URL or its
# credentials. Uses the same new URL().hostname semantics as scripts/e2e-shared.mjs.
db_host="$(node -e 'const u = new URL(process.env.DATABASE_URL); process.stdout.write(u.hostname);' 2>/dev/null || true)"
if [[ -z "$db_host" || ( "$db_host" != "localhost" && "$db_host" != "127.0.0.1" ) ]]; then
  printf '%s\n' \
    "managed-host-run: DATABASE_URL must be a valid URL whose host is localhost or 127.0.0.1." >&2
  exit 1
fi

# Replace this process with the requested command so its exit status and signals
# propagate correctly. No unsafe string evaluation.
exec -- "$@"