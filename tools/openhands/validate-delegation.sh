#!/usr/bin/env bash
#
# validate-delegation.sh — non-destructive Foreman delegation validation.
#
# Proves the RuneSpace Foreman can synchronously delegate to the project-local
# Hard-Problem Advisor and Reviewer sub-agents, and that each specialist runs on
# its intended named model profile, using the ACTUAL discovered agent definitions
# under .agents/agents/ (single source of truth — their system prompts are never
# duplicated here).
#
# Mechanism (installed versions): OpenHands Agent Server 1.35.0 / Agent Canvas v1.4.0
#   - Project-local agents: .agents/agents/*.md (auto-discovered by the server)
#   - Named model profiles:  ~/.openhands/profiles/*.json
#   - Delegation: Agent Canvas POST /api/conversations (separate conversation per
#     specialist, monitored synchronously by the Foreman).
#
# Platform limitation (documented, not worked around silently):
#   The Agent Canvas conversation-creation API has NO field to execute a discovered
#   file agent BY NAME. There is no `agent_name`/`sub_agent` parameter. To keep the
#   repository definitions as the single source of truth, this script LOADS the
#   real .agents/agents/<role>.md file (frontmatter + Markdown system prompt) and
#   applies it to the spawned conversation (system_prompt + tools + model). This
#   guarantees the committed definition governs the run without maintaining a second
#   copy of the prompt.
#
# Non-destructive guarantee:
#   Specialists run against an ISOLATED git clone of the repository (temp dir), never
#   the real working tree. The script records the real repo's HEAD and git status
#   before and after, and FAILS if they differ.
#
# Secret handling:
#   Profiles MUST carry a Fernet-encrypted api_key (starts with "gAAAAA"). Plaintext
#   profiles are rejected; secrets_encrypted is ALWAYS true. No key is printed.
#
# Required env (provided by the agent harness, never committed):
#   SESSION_API_KEY or OH_SESSION_API_KEYS_0 or LOCAL_BACKEND_API_KEY
#   OH_SECRET_KEY (for nothing here, but profiles must already be encrypted)
#   Optionally AGENT_CANVAS_BACKEND (default http://127.0.0.1:8000)
#
# Optional env:
#   ADVISOR_PROFILE   (default: deepseek-v4-pro)
#   REVIEWER_PROFILE  (default: deepseek-v4-pro)
#   RUNESPACE_REPO    (default: /projects/RuneSpace)

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
AGENTS_DIR="$REPO_PATH/.agents/agents"

test -d "$AGENTS_DIR" || { echo "ERROR: agent defs not found at $AGENTS_DIR" >&2; exit 1; }

# ---- pre-flight: reject non-Fernet profiles before any delegation -------------
# Runs at the top level so a bad profile aborts the whole script immediately
# (a plaintext key inside a command substitution would otherwise only fail the
# subshell and let the monitor loop hang). No plaintext fallback is allowed.
verify_profiles() {
  for p in "$ADVISOR_PROFILE" "$REVIEWER_PROFILE"; do
    local f="$HOME/.openhands/profiles/$p.json"
    test -f "$f" || { echo "ERROR: profile '$p' not found at $f. Run tools/openhands/create-profiles.sh first." >&2; exit 1; }
    local ak
    ak="$(jq -r '.api_key' "$f")"
    if [[ "$ak" != gAAAAA* ]]; then
      echo "ERROR: profile '$p' api_key is NOT a Fernet token (must start with gAAAAA). Plaintext keys are forbidden." >&2
      exit 1
    fi
  done
}
verify_profiles

# ---- non-destructive snapshot of the real repo --------------------------------
REAL_HEAD_BEFORE="$(git -C "$REPO_PATH" rev-parse HEAD)"
REAL_STATUS_BEFORE="$(git -C "$REPO_PATH" status --porcelain | md5sum | cut -d' ' -f1)"

SNAPSHOT="$(mktemp -d "$HOME/workspace/runespace-snapshot.XXXXXX")"
git clone --local --no-hardlinks "$REPO_PATH" "$SNAPSHOT" >/dev/null 2>&1
git -C "$SNAPSHOT" checkout "$(git -C "$REPO_PATH" rev-parse --abbrev-ref HEAD)" >/dev/null 2>&1 || true
echo "Isolated snapshot created at: $SNAPSHOT (real repo untouched)"

cleanup_snapshot() { rm -rf "$SNAPSHOT"; }
trap cleanup_snapshot EXIT

# ---- load the actual agent definition (single source of truth) ----------------
# Emits a single JSON object: {name, model, tools:[...], body} where body is the
# Markdown system prompt. No prompt text is duplicated in this script.
load_agent_def() {
  local role="$1"
  local file="$AGENTS_DIR/$role.md"
  test -f "$file" || { echo "ERROR: agent def not found: $file" >&2; exit 1; }
  python3 - "$file" <<'PY'
import json, re, sys
path = sys.argv[1]
text = open(path).read()
m = re.match(r'^---\n(.*?)\n---\n(.*)$', text, re.S)
if not m:
    sys.stderr.write("ERROR: no frontmatter in %s\n" % path); sys.exit(1)
fm, body = m.group(1), m.group(2)
def field(name):
    mm = re.search(r'^%s:\s*(.+)$' % re.escape(name), fm, re.M)
    return mm.group(1).strip() if mm else ""
name = field("name")
model = field("model")
# tools: YAML list under "tools:"
tools = []
tm = re.search(r'^tools:\s*\n((?:[ \t]*-[ \t].*\n?)+)', fm, re.M)
if tm:
    for line in tm.group(1).splitlines():
        t = re.sub(r'^[ \t]*-[ \t]', '', line).strip()
        if t:
            tools.append(t)
print(json.dumps({"name": name, "model": model, "tools": tools, "body": body}))
PY
}

# Read a profile, enforcing Fernet-encrypted api_key and 0600 perms.
read_profile() {
  local profile_name="$1"
  local profile_file="$HOME/.openhands/profiles/$profile_name.json"
  test -f "$profile_file" || { echo "ERROR: profile '$profile_name' not found at $profile_file. Run tools/openhands/create-profiles.sh first." >&2; exit 1; }
  local perms api_key
  perms="$(stat -c '%a' "$profile_file")"
  api_key="$(jq -r '.api_key' "$profile_file")"
  if [[ "$api_key" != gAAAAA* ]]; then
    echo "ERROR: profile '$profile_name' api_key is NOT a Fernet token (must start with gAAAAA). Plaintext keys are forbidden." >&2
    exit 1
  fi
  if [[ "$perms" != "600" ]]; then
    echo "WARN: profile '$profile_name' perms are $perms, expected 0600." >&2
  fi
  jq -r '{model, base_url, api_key}' "$profile_file"
}

# ---- build the conversation payload from the real agent def + profile ---------
build_payload() {
  local role="$1" task="$2"
  local def name model tools body
  def="$(load_agent_def "$role")"
  name="$(printf '%s' "$def" | jq -r .name)"
  model="$(printf '%s' "$def" | jq -r .model)"
  tools="$(printf '%s' "$def" | jq -c .tools)"
  body="$(printf '%s' "$def" | jq -r .body)"

  local profile_json
  # Map role -> profile (per the issue design both default to deepseek-v4-pro).
  if [[ "$role" == "runespace-hard-problem-advisor" ]]; then profile_json="$(read_profile "$ADVISOR_PROFILE")"; fi
  if [[ "$role" == "runespace-reviewer" ]]; then profile_json="$(read_profile "$REVIEWER_PROFILE")"; fi
  local pmodel pbase pkey
  pmodel="$(printf '%s' "$profile_json" | jq -r .model)"
  pbase="$(printf '%s' "$profile_json" | jq -r .base_url)"
  pkey="$(printf '%s' "$profile_json" | jq -r .api_key)"

  # The model used must match the agent def's declared profile name, and the
  # profile model must be the intended stronger model. We assert the agent def's
  # model field equals the profile name we loaded.
  if [[ "$model" != "$ADVISOR_PROFILE" && "$model" != "$REVIEWER_PROFILE" ]]; then
    echo "ERROR: agent '$name' declares model '$model' which is not a known specialist profile." >&2
    exit 1
  fi

  jq -n --arg task "$task" --arg workdir "$SNAPSHOT" --arg smodel "$pmodel" \
    --arg sbase "$pbase" --arg skey "$pkey" --arg name "$name" \
    --arg body "$body" --argjson tools "$tools" '
    {
      secrets_encrypted: true,
      agent_settings: {
        agent_kind: "openhands",
        agent: "CodeActAgent",
        system_prompt: $body,
        llm: {
          model: $smodel,
          api_key: $skey,
          auth_type: "api_key",
          base_url: $sbase,
          num_retries: 5,
          timeout: 300,
          max_message_chars: 30000,
          stream: false,
          native_tool_calling: true
        },
        tools: ($tools | map({name: ., params: {}})),
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
        content: [{type: "text", text: $task}],
        run: true
      }
    }'
  # expose name for the caller via stdout marker is not needed; recorded in spawn
  echo "$name" >&2
}

# ---- spawn + monitor ----------------------------------------------------------
spawn() {
  local role="$1" task="$2"
  local payload cid name
  name="$(load_agent_def "$role" | jq -r .name)"
  local profile="$ADVISOR_PROFILE"
  if [[ "$role" == "runespace-reviewer" ]]; then profile="$REVIEWER_PROFILE"; fi
  payload="$(build_payload "$role" "$task")"
  cid="$(curl -sS -X POST "$BASE/api/conversations" \
    -H "Content-Type: application/json" \
    -H "X-Session-API-Key: $KEY" \
    --data-binary "$payload" | jq -r '.id')"
  echo "TASK|$name|$cid|profile=$profile" >&2
  printf '%s' "$cid"
}

monitor() {
  local cid="$1"
  for i in $(seq 1 80); do
    local status
    status="$(curl -sS -H "X-Session-API-Key: $KEY" "$BASE/api/conversations/$cid" | jq -r '.execution_status')"
    if [ "$status" = "finished" ] || [ "$status" = "error" ] || [ "$status" = "stopped" ]; then
      printf '%s' "$status"
      return
    fi
    sleep 5
  done
  printf 'timeout'
}

# Extract the final assistant MessageEvent (llm_message.role==assistant) via the
# events search API (safe page size, paginated). Returns the text.
extract_assistant_answer() {
  local cid="$1"
  python3 - "$BASE" "$KEY" "$cid" <<'PY'
import json, urllib.request, os, sys
BASE, KEY, CID = sys.argv[1], sys.argv[2], sys.argv[3]
url = f"{BASE}/api/conversations/{CID}/events/search?limit=100"
answers = []
while url:
    req = urllib.request.Request(url, headers={"X-Session-API-Key": KEY})
    d = json.load(urllib.request.urlopen(req))
    for i in d.get("items", d.get("events", [])):
        if not isinstance(i, dict):
            continue
        if i.get("kind") == "MessageEvent":
            lm = i.get("llm_message", {})
            if lm.get("role") == "assistant":
                c = lm.get("content")
                if isinstance(c, str):
                    answers.append(c)
                elif isinstance(c, list):
                    answers.append(" ".join(x.get("text","") for x in c if isinstance(x, dict)))
    np = d.get("next_page_id")
    url = f"{BASE}/api/conversations/{CID}/events/search?limit=100&page_id={np}" if np else None
print((answers[-1] if answers else "")[:4000])
PY
}

echo "=== RuneSpace Foreman delegation validation ==="
echo "Agent Canvas backend: $BASE"
echo "Repo (real, read-only): $REPO_PATH"
echo "Agent defs loaded from: $AGENTS_DIR"

# Task packets (the Foreman's question/instructions — NOT the agent system prompt,
# which is loaded from the .md file).
ADVISOR_TASK="$(cat <<EOF
Inspect this RuneSpace repository snapshot (already checked out at the workspace root).
Answer ONE precise architecture question:

In the RuneSpace boundary map (docs/architecture.md), which directory is the single
source of truth for pure game rules and state transitions, and why must React/UI code
never own those rules?

Use only read-only inspection. Cite the specific file and section that answers the
question. Return a short report: Answer, Reasoning (with file:section), Risks,
Uncertainty, Suggested next step. Do not modify any files.
EOF
)"

REVIEWER_TASK="$(cat <<EOF
Inspect the current git state of this RuneSpace repository snapshot (workspace root).
This branch adds only OpenHands agent orchestration (no gameplay):
  - .agents/agents/runespace-hard-problem-advisor.md
  - .agents/agents/runespace-reviewer.md
  - tools/openhands/* (validation + profile tooling, isolated from the app)

Review statically (no file edits). Return exactly one verdict on the first line
(merge-worthy | not ready | blocker found), then list Blockers, Non-blocking
observations, and Confirmations (no gameplay implemented, no secrets exposed).
EOF
)"

ADVISOR_CID="$(spawn "runespace-hard-problem-advisor" "$ADVISOR_TASK")"
REVIEWER_CID="$(spawn "runespace-reviewer" "$REVIEWER_TASK")"

ADVISOR_STATUS="$(monitor "$ADVISOR_CID")"
REVIEWER_STATUS="$(monitor "$REVIEWER_CID")"

ADVISOR_ANSWER="$(extract_assistant_answer "$ADVISOR_CID")"
REVIEWER_ANSWER="$(extract_assistant_answer "$REVIEWER_CID")"

# Validate the Reviewer verdict is one of the required set. The model may wrap
# the verdict in markdown fences/headings, so search for the first matching line
# rather than trusting the literal first line of the answer.
VERDICT_RAW="$(printf '%s\n' "$REVIEWER_ANSWER" | grep -iE '^[[:space:]]*(merge-worthy|not[ -]?ready|blocker[ -]?found)[[:space:]]*$' | head -1)"
if [ -z "$VERDICT_RAW" ]; then
  # Fallback: find the verdict token anywhere in the text.
  VERDICT_RAW="$(printf '%s\n' "$REVIEWER_ANSWER" | grep -ioE '(merge-worthy|not[ -]?ready|blocker[ -]?found)' | head -1)"
fi
VERDICT="$(printf '%s\n' "$VERDICT_RAW" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]' | sed -E 's/ /-/g')"
case "$VERDICT" in
  merge-worthy|not-ready|blocker-found) VERDICT_OK=1 ;;
  *) VERDICT_OK=0 ;;
esac

# Confirm the specialist actually declared the intended profile name.
ADVISOR_DEF_MODEL="$(load_agent_def runespace-hard-problem-advisor | jq -r .model)"
REVIEWER_DEF_MODEL="$(load_agent_def runespace-reviewer | jq -r .model)"

# ---- non-destructive assertion -------------------------------------------------
REAL_HEAD_AFTER="$(git -C "$REPO_PATH" rev-parse HEAD)"
REAL_STATUS_AFTER="$(git -C "$REPO_PATH" status --porcelain | md5sum | cut -d' ' -f1)"
REPO_UNCHANGED=1
if [ "$REAL_HEAD_BEFORE" != "$REAL_HEAD_AFTER" ] || [ "$REAL_STATUS_BEFORE" != "$REAL_STATUS_AFTER" ]; then
  REPO_UNCHANGED=0
fi

# ---- report --------------------------------------------------------------------
echo "=== EVIDENCE ==="
echo "REAL_REPO_HEAD_BEFORE=$REAL_HEAD_BEFORE"
echo "REAL_REPO_STATUS_BEFORE=$REAL_STATUS_BEFORE"
echo "REAL_REPO_HEAD_AFTER=$REAL_HEAD_AFTER"
echo "REAL_REPO_STATUS_AFTER=$REAL_STATUS_AFTER"
echo "REAL_REPO_UNCHANGED=$REPO_UNCHANGED"
echo "ADVISOR|name=runespace-hard-problem-advisor|profile=$ADVISOR_DEF_MODEL|cid=$ADVISOR_CID|status=$ADVISOR_STATUS"
echo "REVIEWER|name=runespace-reviewer|profile=$REVIEWER_DEF_MODEL|cid=$REVIEWER_CID|status=$REVIEWER_STATUS"
echo "--- ADVISOR ANSWER (first 1500 chars) ---"
printf '%s\n' "${ADVISOR_ANSWER:0:1500}"
echo "--- REVIEWER VERDICT ---"
printf '%s\n' "$REVIEWER_ANSWER" | head -3
echo "REVIEWER_VERDICT=$VERDICT"

# ---- pass/fail -----------------------------------------------------------------
FAIL=0
[ "$ADVISOR_STATUS" = "finished" ] || { echo "FAIL: Advisor not finished ($ADVISOR_STATUS)"; FAIL=1; }
[ "$REVIEWER_STATUS" = "finished" ] || { echo "FAIL: Reviewer not finished ($REVIEWER_STATUS)"; FAIL=1; }
[ -n "$ADVISOR_ANSWER" ] || { echo "FAIL: Advisor answer not retrieved"; FAIL=1; }
[ "$VERDICT_OK" = "1" ] || { echo "FAIL: Reviewer verdict not in required set: '$VERDICT'"; FAIL=1; }
[ "$REPO_UNCHANGED" = "1" ] || { echo "FAIL: REAL repository was modified during validation"; FAIL=1; }
[ "$ADVISOR_DEF_MODEL" = "$ADVISOR_PROFILE" ] || { echo "FAIL: Advisor def model '$ADVISOR_DEF_MODEL' != profile '$ADVISOR_PROFILE'"; FAIL=1; }
[ "$REVIEWER_DEF_MODEL" = "$REVIEWER_PROFILE" ] || { echo "FAIL: Reviewer def model '$REVIEWER_DEF_MODEL' != profile '$REVIEWER_PROFILE'"; FAIL=1; }

if [ "$FAIL" = "1" ]; then
  echo "=== VALIDATION FAILED ==="
  exit 1
fi
echo "=== VALIDATION PASSED ==="
echo "Advisor:  $BASE/conversations/$ADVISOR_CID"
echo "Reviewer: $BASE/conversations/$REVIEWER_CID"
