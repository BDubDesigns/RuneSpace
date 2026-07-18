#!/usr/bin/env bash
#
# create-profiles.sh — register RuneSpace named LLM profiles for the
# OpenHands/Agent Canvas agent-server (operator-level, OUTSIDE the repo).
#
# This script is part of the RuneSpace Foreman tooling. It is intentionally
# kept OUT of the production web runtime (under tools/openhands/, not imported
# by the Next.js app). It writes profiles to ~/.openhands/profiles so they are
# never committed.
#
# Secrets are read from the environment only. Nothing is printed, logged, or
# written into the repository. Run this once on the operator machine that hosts
# the agent-server.
#
# Usage:
#   OPENCODE_API_KEY=... OPENROUTER_API_KEY=... \
#     bash tools/openhands/create-profiles.sh
#
# The OpenCode Go / Zen base URLs default to the documented public endpoints:
#   OPENCODE_GO_BASE_URL   (default: https://opencode.ai/zen/go/v1)
#   OPENCODE_ZEN_BASE_URL  (default: https://opencode.ai/zen/v1)
# Override them via env only if your deployment uses different endpoints.

set -euo pipefail

PROFILE_DIR="${OPENHANDS_PROFILE_DIR:-$HOME/.openhands/profiles}"
mkdir -p "$PROFILE_DIR"

# --- Fail-safe secret handling -------------------------------------------------
# Never write a plaintext credential to disk. The key is Fernet-encrypted with
# the agent-server's own OH_SECRET_KEY derivation so the Agent Canvas conversation
# API can decrypt it server-side (secrets_encrypted: true). If either secret is
# missing, abort — no plaintext fallback is allowed.
: "${OH_SECRET_KEY:?OH_SECRET_KEY is required (agent-server secret key for Fernet encryption)}"
: "${OPENCODE_API_KEY:?OPENCODE_API_KEY is required (shared credential for OpenCode Zen + Go)}"

OPENCODE_GO_BASE_URL="${OPENCODE_GO_BASE_URL:-https://opencode.ai/zen/go/v1}"
OPENCODE_ZEN_BASE_URL="${OPENCODE_ZEN_BASE_URL:-https://opencode.ai/zen/v1}"

# Derive the Fernet key exactly the way the agent-server does (sha256(OH_SECRET_KEY)
# -> urlsafe base64). Encrypt the raw key into a token that starts with "gAAAAA".
# Secrets are read from os.environ inside Python so they never appear in process
# argv (avoids leaking them via `ps`/process listings).
encrypt_key() {
  python3 - <<'PY'
import os, sys, json, hashlib, base64
from cryptography.fernet import Fernet
sec = os.environ["OH_SECRET_KEY"].encode()
raw = os.environ["OPENCODE_API_KEY"].encode()
fk = base64.b64encode(hashlib.sha256(sec).digest())
token = Fernet(fk).encrypt(raw).decode()
assert token.startswith("gAAAAA"), "encryption did not produce a Fernet token"
sys.stdout.write(token)
PY
}

ENCRYPTED_KEY="$(encrypt_key)"

# Sanity: refuse to proceed if encryption did not produce a Fernet token.
if [[ "$ENCRYPTED_KEY" != gAAAAA* ]]; then
  echo "ERROR: OPENCODE_API_KEY encryption failed (expected Fernet token)." >&2
  exit 1
fi

write_profile() {
  local name="$1" model="$2" base_url="$3"
  local path="$PROFILE_DIR/$name.json"
  # Write with owner-only permissions from the start, then chmod 0600.
  umask 077
  cat > "$path" <<EOF
{
  "model": "$model",
  "api_key": "$ENCRYPTED_KEY",
  "auth_type": "api_key",
  "base_url": "$base_url",
  "openrouter_site_url": "https://docs.all-hands.dev/",
  "openrouter_app_name": "OpenHands",
  "num_retries": 5,
  "retry_multiplier": 8.0,
  "retry_min_wait": 8,
  "retry_max_wait": 64,
  "timeout": 300,
  "max_message_chars": 30000,
  "stream": false,
  "drop_params": true,
  "modify_params": true,
  "disable_stop_word": false,
  "caching_prompt": true,
  "log_completions": false,
  "log_completions_folder": "logs/completions",
  "native_tool_calling": true,
  "reasoning_effort": "high",
  "enable_encrypted_reasoning": true,
  "prompt_cache_retention": "24h",
  "extended_thinking_budget": 200000,
  "usage_id": "default",
  "litellm_extra_body": {},
  "is_subscription": false,
  "schema_version": 1
}
EOF
  chmod 0600 "$path"
  echo "wrote profile (0600, encrypted key): $path"
}

# DeepSeek V4 Pro through the OpenCode Go-compatible endpoint.
# Shares the encrypted OPENCODE_API_KEY with the Zen fallback.
write_profile "deepseek-v4-pro" "openai/deepseek-v4-pro" "$OPENCODE_GO_BASE_URL"

# HY3 fallback through the OpenCode Zen-compatible endpoint.
# Shares the same encrypted OPENCODE_API_KEY.
write_profile "hy3-opencode-zen" "openai/hy3-free" "$OPENCODE_ZEN_BASE_URL"

echo "Profiles created in $PROFILE_DIR (mode 0600, api_key is Fernet-encrypted)."
echo "Both 'deepseek-v4-pro' and 'hy3-opencode-zen' use the encrypted shared OPENCODE_API_KEY."
echo "The model strings use the 'openai/' provider prefix required by litellm for custom base_urls."
