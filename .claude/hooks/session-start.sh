#!/bin/bash
# SessionStart hook for RuneSpace cloud sessions. Runs synchronously so dependencies,
# the local PostgreSQL cluster and the test environment are ready before the agent starts.
# Idempotent and non-interactive. Local/test plumbing only: never touches production
# databases, Coolify, or the managed host's private environment file.
set -uo pipefail

# Local sessions already have their own setup; only the web sandbox needs this.
if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

REPO_DIR="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
log() { printf '[session-start] %s\n' "$*" >&2; }
fail=0

# 1. Environment for test commands. Written to CLAUDE_ENV_FILE so it is available to
#    every later command in the session. These are local throwaway values: the
#    database is 127.0.0.1-only with trust auth, and the auth secret only signs
#    sessions for that disposable database.
DB_URL="postgres://postgres@127.0.0.1:5432/postgres"
AUTH_SECRET="runespace-throwaway-local-only-secret"
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  # Written once per session file; the marker keeps reruns from duplicating lines.
  if ! grep -q "runespace-session-start" "$CLAUDE_ENV_FILE" 2>/dev/null; then
    {
      echo "# runespace-session-start"
      echo "export DATABASE_URL=\"$DB_URL\""
      echo "export BETTER_AUTH_SECRET=\"$AUTH_SECRET\""
    } >> "$CLAUDE_ENV_FILE"
  fi
else
  log "CLAUDE_ENV_FILE not set; DATABASE_URL/BETTER_AUTH_SECRET not persisted"
fi
export DATABASE_URL="$DB_URL" BETTER_AUTH_SECRET="$AUTH_SECRET"

# 2. PostgreSQL 16 (integration and E2E). Create the cluster once, then start it.
PG_BIN=/usr/lib/postgresql/16/bin
PG_DATA=/var/lib/pg-runespace
if [ -x "$PG_BIN/pg_ctl" ]; then
  if [ ! -f "$PG_DATA/PG_VERSION" ]; then
    log "initialising PostgreSQL cluster at $PG_DATA"
    mkdir -p "$PG_DATA" && chown postgres:postgres "$PG_DATA"
    su postgres -c "$PG_BIN/initdb -D $PG_DATA -A trust -U postgres" >/dev/null 2>&1 \
      || { log "FAILED: initdb"; fail=1; }
  fi
  if ! su postgres -c "$PG_BIN/pg_ctl -D $PG_DATA status" >/dev/null 2>&1; then
    su postgres -c "$PG_BIN/pg_ctl -D $PG_DATA -l /tmp/pg.log -o '-c listen_addresses=127.0.0.1' start" >/dev/null 2>&1 \
      && log "PostgreSQL started on 127.0.0.1:5432" \
      || { log "FAILED: pg_ctl start (see /tmp/pg.log)"; fail=1; }
  else
    log "PostgreSQL already running"
  fi
else
  log "WARN: PostgreSQL 16 not found at $PG_BIN; integration tests will be skipped"
fi

# 3. Node dependencies from the lockfile (pnpm 9.15.4 is pinned in package.json).
if command -v pnpm >/dev/null 2>&1; then
  (cd "$REPO_DIR" && pnpm install --frozen-lockfile >/tmp/pnpm-install.log 2>&1) \
    && log "pnpm install ok" \
    || { log "FAILED: pnpm install (see /tmp/pnpm-install.log)"; fail=1; }
else
  log "FAILED: pnpm not on PATH"; fail=1
fi

# 4. Playwright browser. The repo pins Playwright 1.51.1, which expects Chromium build
#    1161; the image ships 1194. Alias the pinned path to the shipped build. This is a
#    workaround, not CI's exact browser.
PW=/opt/pw-browsers
if [ -d "$PW/chromium_headless_shell-1194" ] && [ ! -e "$PW/chromium_headless_shell-1161" ]; then
  ln -s "$PW/chromium_headless_shell-1194" "$PW/chromium_headless_shell-1161" \
    && log "aliased chromium_headless_shell-1161 -> 1194 (workaround)"
fi
[ -e "$PW/chromium_headless_shell-1161/chrome-linux/headless_shell" ] \
  || log "WARN: no headless shell at the pinned Playwright path; browser tests may fail"

if [ "$fail" -ne 0 ]; then
  log "finished with failures above"
  exit 1
fi
log "ready"
exit 0
