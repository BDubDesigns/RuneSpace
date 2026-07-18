# RuneSpace Foreman Runbook

How to run the RuneSpace OpenHands Foreman workflow: one approved GitHub issue at
a time, implemented with HY3 by default, with conditional synchronous delegation
to stronger specialist sub-agents.

This document is the human-facing companion to the machine-readable agent
definitions in `.agents/agents/`. It exists because Issue #2 replaces the repeated
manual copy/paste loop where Brandon asked ChatGPT to inspect the repo and craft
every implementation prompt. With this setup, Brandon points the Foreman at an
approved issue and the Foreman does the inspection, planning, implementation,
testing, and review delegation itself — humans stay in control of product
direction and merges.

> Platform boundary: RuneSpace uses **OpenHands / OpenHands Agent Canvas** as the
> agent harness. OpenCode Go and OpenCode Zen are provider endpoints only. There
> are no `.opencode` files and no OpenCode agent configuration in this repo.

## Installed versions (verified for this setup)

- **OpenHands Agent Server**: `1.35.0` (SDK `1.35.0`, tools `1.35.0`)
- **Agent Canvas**: build `v1.4.0`
- **Agent kind**: `openhands` — agent `CodeActAgent`
- **Default Foreman model**: `openrouter/tencent/hy3:free` via the `hy3-free`
  LLM profile (HY3 through OpenRouter)
- **Node**: 22 (pinned), **pnpm**: 9.15.4 (pinned)

These versions support exactly the mechanisms used below. If you upgrade
OpenHands/Agent Canvas, re-verify the delegation path (see *Known limitations*).

## Roles

| Role | Model profile | When | Read-only? |
|------|---------------|------|-----------|
| **Foreman** (you / the main agent) | `hy3-free` (HY3 OpenRouter) | Always — implements one approved issue | No (implements) |
| **Hard-Problem Advisor** | `deepseek-v4-pro` (DeepSeek V4 Pro, OpenCode Go) | On escalation triggers (see below) | Yes |
| **Reviewer** | `deepseek-v4-pro` (same profile) | Before opening/updating the draft PR | Yes |

All three roles obey `AGENTS.md` and `docs/` as the repository-wide authority.
The Foreman never invents mechanics, balance, lore, or architecture, never picks
its own next issue, never merges its own PR, and stops for human review.

## Project-local agent discovery

Specialists are **file-based agents** discovered automatically by OpenHands 1.35
from this directory (highest priority):

```
.agents/agents/
  runespace-hard-problem-advisor.md
  runespace-reviewer.md
```

Each file is Markdown with YAML frontmatter (`name`, `description`, `model`,
`tools`, `color`, `permission_mode`, `max_iteration_per_run`) and a Markdown body
that becomes the sub-agent's system prompt. The `model` field names an LLM
profile (see below). The Foreman references them by `name` when delegating.

Verify discovery at any time:

```bash
curl -sS -X POST "$AGENT_CANVAS_BACKEND/api/sub-agents" \
  -H "X-Session-API-Key: $SESSION_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"load_project": true, "load_user": false, "load_builtin": false, "project_dir": "/path/to/RuneSpace"}' \
  | jq '.agents[] | {name, model, tools, permission_mode}'
```

Both specialists must show `"model": "deepseek-v4-pro"`.

## Named provider / model profiles

Profiles live in the operator's `~/.openhands/profiles/*.json` (outside the repo,
so no secrets are committed). The Foreman's `hy3-free` profile already exists.
Create the two RuneSpace specialist/fallback profiles with the provided script:

```bash
# Defaults (already correct for the documented OpenCode endpoints):
#   OPENCODE_GO_BASE_URL=https://opencode.ai/zen/go/v1
#   OPENCODE_ZEN_BASE_URL=https://opencode.ai/zen/v1
OPENCODE_API_KEY="$OPENCODE_API_KEY" \
  bash tools/openhands/create-profiles.sh
```

This writes (with **owner-only 0600 perms** and a **Fernet-encrypted** `api_key`):

- `deepseek-v4-pro.json` — `openai/deepseek-v4-pro` via `OPENCODE_GO_BASE_URL`,
  using the shared `OPENCODE_API_KEY`. **Note the `openai/` provider prefix** —
  litellm requires it for a custom OpenAI-compatible `base_url`, otherwise the
  agent server throws `LLMBadRequestError: LLM Provider NOT provided`.
- `hy3-opencode-zen.json` — HY3 fallback via `OPENCODE_ZEN_BASE_URL`, using the
  **same** shared `OPENCODE_API_KEY`.

The key is encrypted with the agent-server's `OH_SECRET_KEY` derivation (sha256 →
base64 Fernet key) so the Agent Canvas conversation API can decrypt it server-side
(`secrets_encrypted: true`). `create-profiles.sh` aborts if `OH_SECRET_KEY` or
`OPENCODE_API_KEY` is missing, and never writes a plaintext key to disk.

> The shared `OPENCODE_API_KEY` authenticates both the OpenCode Go (escalation)
> and OpenCode Zen (HY3 fallback) endpoints. `OPENROUTER_API_KEY` powers the
> default `hy3-free` Foreman profile. `OPENAI_API_KEY` is available but is **not**
> the default and is only used if you later choose an OpenAI validation path.

## Provider ladder & fallback

1. **Primary**: Foreman implements with HY3 through OpenRouter (`hy3-free`).
2. **Fallback (genuine rate limit / outage only)**: switch the Foreman profile to
   `hy3-opencode-zen` (HY3 through OpenCode Zen, same `OPENCODE_API_KEY`). This is
   a deliberate, documented switch — not a silent retry loop.
3. **Escalate on hard problems**: delegate to the Advisor on `deepseek-v4-pro`
   (OpenCode Go). Difficulty triggers the Advisor; it never triggers a silent
   provider switch.
4. (Future) OpenAI/Codex could be added as another profile if the OAuth scope
   problem is later resolved.

Clean automatic fallback is not wired into the agent runtime because the OpenCode
endpoints are operator-specific and the agent server resolves one profile per
conversation. The supported, safe behavior is the **deterministic manual switch**:
set the Foreman's active profile to `hy3-opencode-zen` (or set
`OPENCODE_GO_BASE_URL` and re-run `create-profiles.sh`) and re-run. Do not add
brittle retry hacks. Always record which provider/model handled the task.

## Conditional escalation rules (Foreman → Advisor)

Delegate to the Hard-Problem Advisor only when at least one holds:

1. Two materially different implementation attempts failed.
2. A type error exposes a contract/architecture problem, not a local typo.
3. The change crosses three or more feature/domain boundaries.
4. Transaction, concurrency, replay, or duplicate-award correctness is unclear.
5. Tests and repository docs conflict.
6. A shared extraction would affect several screens/features and ownership is unclear.
7. A security, auth, authorization, secret-handling, or data-integrity question appears.
8. The Foreman cannot determine which source is authoritative.
9. The diff grows substantially beyond what the issue implies.
10. Self-review finds a likely blocker.

Do **not** escalate ordinary syntax errors, straightforward lint failures, or the
first minor obstacle.

When escalating, send a compact packet (issue goal + acceptance criteria,
governing architecture rules, files inspected, current approach, exact failure,
attempts already made, competing options, one precise question). The Advisor
returns a short report: Answer, Reasoning (file:section), Options, Risks,
Uncertainty, Suggested next step.

## Synchronous delegation mechanism

OpenHands 1.35 delegates via the **Task tool** (`task`/`task_tool_set`) inside a
conversation, or — in Agent Canvas — by spawning a separate conversation through
`POST /api/conversations` that inherits the caller's encrypted settings (or a
named `agent_profile_id`). The Foreman waits for the specialist's result before
proceeding (synchronous). Sub-agent task IDs are returned by the API and can be
persisted for resumption.

The validation script (`tools/openhands/validate-delegation.sh`) demonstrates the
Agent Canvas delegation path end-to-end without modifying any repo files.

## Required task checklist (Foreman)

- [ ] Read issue, `AGENTS.md`, and relevant `docs/`
- [ ] Inspect relevant code and current CI workflow (`.github/workflows/ci.yml`)
- [ ] Identify existing reusable pieces
- [ ] Write a bounded implementation plan
- [ ] Implement acceptance criteria
- [ ] Add or update tests
- [ ] Run CI-parity checks from a clean install (`pnpm install --frozen-lockfile`,
      pinned Node/pnpm, mirror CI env without leaking secrets)
- [ ] Review diff for SSOT, extraction, abstraction, dependencies, scope
- [ ] Invoke Hard-Problem Advisor if escalation criteria were met
- [ ] Invoke Reviewer before completion
- [ ] Address blocking reviewer findings
- [ ] Push branch and inspect remote GitHub Actions
- [ ] Correct CI-only failures on the same branch until green or blocked
- [ ] Open/update draft PR with evidence
- [ ] Stop

Do not mark a task complete until evidence exists.

## Clean CI-parity workflow

Issue #1 taught us: local checks passed but CI failed because
`NODE_ENV=production` was scoped to the whole CI job, causing pnpm to omit
devDependencies. Account for this class of mismatch permanently:

```bash
git checkout -b <branch> origin/main
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
NODE_ENV=production DATABASE_URL=postgres://runespace:runespace@localhost:5432/runespace \
  pnpm build
```

Then push and inspect the remote workflow; keep fixing the same branch until the
required checks are green (or a genuine external blocker is documented). Passing
local checks is only preflight — required remote CI is the completion condition.

## Validation scenario (non-destructive)

Proves parent→sub-agent delegation works, modifies no application files:

```bash
bash tools/openhands/validate-delegation.sh
```

It spawns a read-only Advisor conversation (architecture question), then a
read-only Reviewer conversation, and prints task IDs, roles, statuses, the model
profile each used, and concise summaries. The `deepseek-v4-pro` profile must point
at the real OpenCode Go endpoint (`openai/deepseek-v4-pro`) and carry the
Fernet-encrypted `OPENCODE_API_KEY`; the script then runs the specialists on the
stronger model **with tools**. This is the required real delegation, not a HY3
stand-in — HY3 is only the Foreman's default implementation profile and is never
presented as proof that the stronger-model advisors work.

## How to change the hard-model profile later

1. Create/modify `~/.openhands/profiles/<new-profile>.json` (model + base_url +
   key).
2. Update `model:` in `.agents/agents/runespace-hard-problem-advisor.md` and
   `.agents/agents/runespace-reviewer.md` to the new profile name.
3. Re-run discovery and validation.

## Known limitations (installed OpenHands 1.35.0 / Agent Canvas v1.4.0)

- **No native `agent_name` execution.** The Agent Canvas `POST /api/conversations`
  API has **no field** to execute a discovered `.agents/agents/*.md` file agent by
  name (no `agent_name`/`sub_agent` parameter). To keep the repository definitions
  as the single source of truth, `validate-delegation.sh` **loads** the real agent
  file (frontmatter + Markdown system prompt) and applies it as the conversation's
  `system_prompt` + `tools` + `model`. This proves the committed definition governs
  the run without duplicating the prompt. If a future Agent Canvas version adds
  named-agent execution, switch to it and delete the loader.
- **`agent_profile_id` gives zero exec tools.** When delegating via a named
  profile through the Agent Canvas conversation API, the profile-based path
  cannot attach tools. The validation script reads the profile's encrypted
  `api_key`/`base_url`/`model` and sends them as encrypted `agent_settings` with
  tools merged in (`secrets_encrypted: true`). Plaintext keys are forbidden.
- **One profile per conversation.** There is no automatic in-runtime provider
  fallback; switches are manual/documented (see *Provider ladder*).
- **Non-destructive validation.** Specialists run against an ISOLATED `git clone`
  of the repo (temp dir), never the real working tree. The script asserts the real
  repo's HEAD + `git status` are unchanged before/after; it fails if they differ.
  The agent `.md` files include `file_editor` (so a specialist *could* propose a
  patch), but read-only behavior is enforced two ways: (1) the agent's explicit
  "read-only" hard constraint in its system prompt, and (2) the fact that it runs
  on a throwaway clone — any write lands in `/tmp`, never in the real branch.
- **OpenCode endpoints are operator-specific.** The repo intentionally does not
  hard-code base URLs or keys. `create-profiles.sh` takes them from the
  environment and now defaults to the documented endpoints
  (`https://opencode.ai/zen/go/v1` and `https://opencode.ai/zen/v1`). These are
  verified working in this sandbox; the `hy3-opencode-zen` HY3 fallback is
  configured the same way for Foreman use only if OpenRouter is unavailable.
- **No secrets in the repo.** Profiles are operator-local (0600, Fernet-encrypted).
  Agent `.md` files only name profiles; they contain no credentials.
- **Tribal knowledge.** The persistent `/projects/AGENT_BUILDING_GUIDE.md` is a
  working note; the authoritative version-controlled reference is this runbook
  plus the script headers. Do not rely on the external file for CI.
