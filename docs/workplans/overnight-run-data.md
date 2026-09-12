# Overnight run — local-only data export (2026-09-12)

Exported from Brandon's laptop before the retrospective session, because a
cloud session cannot read local Claude Code transcripts or Codex config.
Source: `~/.claude/projects/-home-brandon-Documents-ChatGPT-RuneSpace/*.jsonl`
(assistant usage records deduplicated by message id). Times are UTC.

## Token usage — the overnight run

Main transcript `4b9f2428…` (Opus 5, orchestrator/reviewer) plus its three
Sonnet 5 subagents. Captured at the end of the overnight run (before the
same-day follow-ups).

| Agent | Model | Turns | Output | Cache read | Cache write | Uncached input | Active window |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Orchestrator | claude-opus-5 | 174 | 245k | 64.3M | 1.11M | ~4k | 10:12 → 17:24 |
| Architecture survey (read-only) | claude-sonnet-5 | 25 | 15k | 1.57M | 97k | ~0 | 10:39 → 10:42 |
| #143 projection unit tests | claude-sonnet-5 | 14 | 31k | 1.60M | 155k | ~0 | 10:59 → 11:04 |
| #143 docs / Wiki / Update | claude-sonnet-5 | 34 | 30k | 3.99M | 113k | ~0 | 11:02 → 11:08 |
| **Sonnet total** | | 73 | 75k | 7.15M | 365k | ~0 | |

Opus produced ~77% of output tokens: implementation mostly stayed on the
expensive model.

For scale (main transcripts only): the preceding session in the same job
(`1822a2df…`, #171 follow-ups, 02:30 → 09:47) used Opus 328 turns / 403k
output / 166M cache read; the Sep 9–11 session (`989c1e44…`) used Opus 322
turns / 328k output / 136M cache read plus Sonnet 154 turns / 135k output.

Plan usage as reported by `/usage` afterwards: weekly (all models) ≈ 10%
(roughly +1% attributed by Brandon to the overnight run); the 5-hour session
window had reset (3–5% reflects only later activity). There is no built-in
per-run or peak-window report; transcript token counts are the only per-run
source.

## Time profile — main transcript

At export time the transcript spans 9.1 h (overnight run + morning
follow-ups). 206 assistant turns; gaps between consecutive turns:
`<30 s`: 145 · `30 s–2 m`: 51 · `2–10 m`: 5 · `>10 m`: 4 (longest 323 min —
Brandon asleep/reviewing). Gaps over 2 min sum to 7.8 h (86% of the span).
Recompute per phase from the ledger's timestamps if needed.

Human prompts in the transcript: 11 (kickoff, clarifications, morning review,
corrections, questions).

## CI

`gh run list` durations are unreliable for this (draft runs "fail" on the
intentional Merge gate; `updatedAt − createdAt` reflects the last job, not
total compute). Use per-job timings from `gh run view <id> --json jobs` if CI
minutes matter. Relevant run ids are in the ledger and PR #180 comments.

## Codex CLI (for the Luna handoff trial — local only)

- `codex-cli 0.154.0` at `~/.local/bin/codex`; signed in (`~/.codex/auth.json`
  present — never copy it).
- `~/.codex/config.toml`: `model = "gpt-5.6-luna"`,
  `model_reasoning_effort = "xhigh"`; enabled efforts: low, medium, high,
  xhigh, max. `~/.codex/AGENTS.md` exists (global Codex instructions —
  read before the trial).
- Non-interactive: `codex exec` (alias `e`); `-m, --model <MODEL>`;
  `-c key=value` config overrides; `codex doctor` for health checks.
