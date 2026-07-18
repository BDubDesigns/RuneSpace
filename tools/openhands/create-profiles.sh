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
# The OpenCode Go / Zen base URLs are operator-specific. Provide them via env:
#   OPENCODE_GO_BASE_URL   (default: https://go.opencode.example/v1)
#   OPENCODE_ZEN_BASE_URL  (default: https://zen.opencode.example/v1)
#
# If the default placeholders are used, the profile will be created but the
# deeper-model delegation will only work once Brandon replaces the base_url
# with the real OpenCode endpoint in ~/.openhands/profiles/deepseek-v4-pro.json.

set -euo pipefail

PROFILE_DIR="${OPENHANDS_PROFILE_DIR:-$HOME/.openhands/profiles}"
mkdir -p "$PROFILE_DIR"

: "${OPENCODE_API_KEY:?OPENCODE_API_KEY is required (shared credential for OpenCode Zen + Go)}"
OPENCODE_GO_BASE_URL="${OPENCODE_GO_BASE_URL:-https://go.opencode.example/v1}"
OPENCODE_ZEN_BASE_URL="${OPENCODE_ZEN_BASE_URL:-https://zen.opencode.example/v1}"

# Refuse to write non-functional placeholder endpoints. The operator must supply
# the real OpenCode base URLs via env vars; otherwise delegation silently fails.
if [[ "$OPENCODE_GO_BASE_URL" == *".example/"* || "$OPENCODE_ZEN_BASE_URL" == *".example/"* ]]; then
  echo "ERROR: OPENCODE_GO_BASE_URL / OPENCODE_ZEN_BASE_URL still point at the placeholder" >&2
  echo "       '.example' domain. Set the real OpenCode endpoints (see the Issue #2 runbook)" >&2
  echo "       before running this script." >&2
  exit 1
fi

write_profile() {
  local name="$1" model="$2" base_url="$3" key="$4"
  local path="$PROFILE_DIR/$name.json"
  cat > "$path" <<EOF
{
  "model": "$model",
  "api_key": "$key",
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
  echo "wrote profile: $path"
}

# DeepSeek V4 Pro through the OpenCode Go-compatible endpoint.
# Shares OPENCODE_API_KEY with the Zen fallback.
write_profile "deepseek-v4-pro" "openai/deepseek-v4-pro" "$OPENCODE_GO_BASE_URL" "$OPENCODE_API_KEY"

# HY3 fallback through the OpenCode Zen-compatible endpoint.
# Shares the same OPENCODE_API_KEY.
write_profile "hy3-opencode-zen" "openai/hy3-free" "$OPENCODE_ZEN_BASE_URL" "$OPENCODE_API_KEY"

echo "Profiles created in $PROFILE_DIR"
echo "Both 'deepseek-v4-pro' and 'hy3-opencode-zen' reference the shared OPENCODE_API_KEY."
echo "The model strings use the 'openai/' provider prefix required by litellm for custom base_urls."
