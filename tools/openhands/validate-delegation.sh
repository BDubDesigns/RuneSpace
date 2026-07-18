#!/usr/bin/env bash
#
# validate-delegation.sh — non-destructive Foreman delegation validation.
#
# Proves the RuneSpace Foreman can synchronously delegate to the project-local
# Hard-Problem Advisor and Reviewer sub-agents via the Agent Canvas conversation
# API, and that each specialist runs on its intended named model profile.
#
# This script is part of the RuneSpace Foreman tooling and is kept OUT of the
# production web runtime. It performs only read-only delegation; it never
# modifies repository source, tests, or docs.
#
# Mechanism (installed versions):
#   OpenHands Agent Server 1.35.0 / Agent Canvas v1.4.0
#   - Project-local agents: .agents/agents/*.md (auto-discovered)
#   - Named model profiles:  ~/.openhands/profiles/*.json
#   - Delegation: Agent Canvas POST /api/conversations (separate conversation
#     per specialist, monitored by the Foreman conversation).
#
# Required env (provided by the agent harness, never committed):
#   SESSION_API_KEY or OH_SESSION_API_KEYS_0 or LOCAL_BACKEND_API_KEY
#   Optionally AGENT_CANVAS_BACKEND (default http://127.0.0.1:8000)
#
# Optional env to force a model profile for a specialist (for fallback testing):
#   ADVISOR_PROFILE   (default: deepseek-v4-pro)
#   REVIEWER_PROFILE  (default: deepseek-v4-pro)

set -euo pipefail

BASE="${AGENT_CANVAS_BACKEND:-http://127.0.0.1:8000}"
KEY="${SESSION_API_KEY:-${OH_SESSION_API_KEYS_0:-${LOCAL_BACKEND_API_KEY:-}}}"
if [ -z "$KEY" ] && [ -f "$HOME/.openhands/agent-canvas/api-key.txt" ]; then
  KEY="$(tr -d '\n' < "$HOME/.openhands/agent-canvas/api-key.txt")"
fi
test -n "$KEY" || { echo "No Agent Canvas session API key found" >&2; exit 1; }

ADVISOR_PROFILE="${ADVISOR_PROFILE:-deepseek-v4-pro}"
REVIEWER_PROFILE="${REVIEWER_PROFILE:-deepseek-v4-pro}"

REPO_PATH="${RUNESPACE_REPO:-/projects/RuneSpace}"
WORKDIR="${WORKDIR:-$HOME/workspace/delegated/$(date +%s)}"
mkdir -p "$WORKDIR"

advisor_prompt() {
  cat <<EOF
You are the RuneSpace Hard-Problem Advisor (read-only). Inspect the RuneSpace
repository at $REPO_PATH. Answer ONE precise architecture question:

Question: In the RuneSpace boundary map (docs/architecture.md), which directory
is the single source of truth for pure game rules and state transitions, and
why must React/UI code never own those rules?

Use only read-only inspection. Cite the specific file and section that answers
the question. Return a short report: Answer, Reasoning (with file:section),
Risks, Uncertainty, Suggested next step. Do not modify any files.
EOF
}

reviewer_prompt() {
  cat <<EOF
You are the RuneSpace Reviewer (read-only). Inspect the current git state of the
RuneSpace repository at $REPO_PATH on branch $(git -C "$REPO_PATH" rev-parse --abbrev-ref HEAD 2>/dev/null).

This branch adds only OpenHands agent orchestration (no gameplay):
  - .agents/agents/runespace-hard-problem-advisor.md
  - .agents/agents/runespace-reviewer.md
  - tools/openhands/* (validation + profile tooling, isolated from the app)

Review statically (no file edits). Return exactly one verdict on the first line
(merge-worthy | not ready | blocker found), then list Blockers, Non-blocking
observations, and Confirmations (no gameplay implemented, no secrets exposed).
EOF
}

# Resolve an agent_settings payload + secrets flag for a named model profile.
#
# Supported mode (installed OpenHands 1.35.0 / Agent Canvas v1.4.0):
#
# Profile-file mode (REAL stronger model): read model/base_url + api_key from
# ~/.openhands/profiles/<profile>.json and merge into agent_settings with the
# exec tools the specialist needs. If the profile api_key is a Fernet token
# (starts with "gAAAAA") we send secrets_encrypted: true so the agent-server
# decrypts it server-side; otherwise we send the literal key with
# secrets_encrypted: false. This gives the specialist BOTH the stronger model
# AND read-only tools.
build_payload() {
  local profile_name="$1" prompt="$2"
  local profile_file="$HOME/.openhands/profiles/$profile_name.json"

  if [ ! -f "$profile_file" ]; then
    echo "ERROR: profile '$profile_name' not found at $profile_file. Run tools/openhands/create-profiles.sh first." >&2
    return 1
  fi

  local model base_url api_key
  model="$(jq -r '.model' "$profile_file")"
  base_url="$(jq -r '.base_url' "$profile_file")"
  api_key="$(jq -r '.api_key' "$profile_file")"

  local secrets_encrypted="false"
  if [[ "$api_key" == gAAAAA* ]]; then
    secrets_encrypted="true"
  fi

  jq -n --arg prompt "$prompt" --arg workdir "$WORKDIR" --arg model "$model" \
    --arg base_url "$base_url" --arg api_key "$api_key" --argjson sec "$secrets_encrypted" '
    {
      secrets_encrypted: $sec,
      agent_settings: {
        agent_kind: "openhands",
        agent: "CodeActAgent",
        llm: {
          model: $model,
          api_key: $api_key,
          auth_type: "api_key",
          base_url: $base_url,
          num_retries: 5,
          timeout: 300,
          max_message_chars: 30000,
          stream: false,
          native_tool_calling: true
        },
        tools: [
          {name: "terminal", params: {}},
          {name: "file_editor", params: {}},
          {name: "task_tracker", params: {}},
          {name: "browser_tool_set", params: {}}
        ],
        enable_sub_agents: false,
        agent_context: {
          load_public_skills: true,
          load_user_skills: true,
          load_project_skills: true
        }
      },
      workspace: {kind: "LocalWorkspace", working_dir: $workdir},
      confirmation_policy: {kind: "NeverConfirm"},
      max_iterations: 500,
      stuck_detection: true,
      autotitle: true,
      worktree: false,
      initial_message: {
        role: "user",
        content: [{type: "text", text: $prompt}],
        run: true
      }
    }'
}

spawn() {
  local role="$1" profile="$2" prompt="$3"
  local payload cid status
  payload="$(build_payload "$profile" "$prompt")"
  cid="$(curl -sS -X POST "$BASE/api/conversations" \
    -H "Content-Type: application/json" \
    -H "X-Session-API-Key: $KEY" \
    --data-binary "$payload" | jq -r '.id')"
  # Log the task record to stderr; emit ONLY the id on stdout so callers can
  # capture it cleanly.
  echo "TASK|$role|$cid|$profile" >&2
  printf '%s' "$cid"
}

echo "=== RuneSpace Foreman delegation validation ==="
echo "Agent Canvas backend: $BASE"
echo "Repo: $REPO_PATH"
ADVISOR_CID="$(spawn "runespace-hard-problem-advisor" "$ADVISOR_PROFILE" "$(advisor_prompt)")"
REVIEWER_CID="$(spawn "runespace-reviewer" "$REVIEWER_PROFILE" "$(reviewer_prompt)")"

echo "=== Monitoring (polling until finished) ==="
for cid in "$ADVISOR_CID" "$REVIEWER_CID"; do
  for i in $(seq 1 60); do
    status="$(curl -sS -H "X-Session-API-Key: $KEY" "$BASE/api/conversations/$cid" | jq -r '.execution_status')"
    if [ "$status" = "finished" ] || [ "$status" = "error" ] || [ "$status" = "stopped" ]; then
      break
    fi
    sleep 5
  done
  echo "CONV|$cid|status=$status"
done

echo "=== Advisor summary (conversation detail) ==="
curl -sS -H "X-Session-API-Key: $KEY" "$BASE/api/conversations/$ADVISOR_CID" \
  | jq -r '{id, execution_status, title, summary, model: .current_model_id} | "id=\(.id)\nstatus=\(.execution_status)\nmodel=\(.model)\ntitle=\(.title)\nsummary=\(.summary // "n/a")"'

echo "=== Reviewer verdict (conversation detail) ==="
curl -sS -H "X-Session-API-Key: $KEY" "$BASE/api/conversations/$REVIEWER_CID" \
  | jq -r '{id, execution_status, title, summary, model: .current_model_id} | "id=\(.id)\nstatus=\(.execution_status)\nmodel=\(.model)\ntitle=\(.title)\nsummary=\(.summary // "n/a")"'

echo "=== Links ==="
echo "Advisor:  $BASE/conversations/$ADVISOR_CID"
echo "Reviewer: $BASE/conversations/$REVIEWER_CID"
