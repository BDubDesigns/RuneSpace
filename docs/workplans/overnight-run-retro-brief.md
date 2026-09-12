# Overnight run retrospective — research brief (for the lunch session)

This brief is self-contained so a fresh session (cloud or local) can do the
work without the original conversation. It is a work request, not a normative
doc.

## Background

On 2026-09-12 an Opus 5 orchestration session ran #176 overnight: #173 → #143
→ #174 integrated sequentially into `staging/mission-guidance-cleanup`, with
Sonnet 5 subagents for bounded pieces, then a draft `staging → main` PR (#180)
for Brandon's preview review. Brandon's review produced one correction pass
(`ec4d441`); he then planned to merge #180.

Evidence to read (all in the repo / GitHub):

- `docs/workplans/mission-guidance-cleanup-run.md` — the run ledger (every SHA,
  plan, decision, incident, test result, correction pass).
- PRs #177 (#173), #178 (#143), #179 (#174), #180 (combined) — bodies and
  comments, CI runs; issue #176 comment.
- `docs/screenshots/issue-173/`, `issue-143/`, `issue-174/`,
  `pr-180-corrections/` — rendered evidence, including before/after.
- `docs/workplans/overnight-run-data.md` — local-only metrics (token usage,
  idle time, subagent use, Codex CLI facts) exported before the session moved.
- `AGENTS.md`, `docs/development-workflow.md`, `docs/testing-strategy.md` —
  current normative contract.

## Brandon's request

What did we learn from running overnight?

- What was done well and should be documented/codified for future autonomous
  runs?
- What didn't work well and would benefit from research and/or
  experimentation?
- What other metrics are useful? What is Brandon not thinking about?
- Economics: the Claude Max 5x plan is a free one-month trial. Afterward Brandon
  may be on Claude Pro ($20/mo). Proposed setup: Opus (Claude Code, Pro plan)
  as brain/orchestrator/reviewer, handing well-scoped, bounded implementation
  tasks to **ChatGPT `gpt-5.6-luna` at `xhigh`** via the **Codex CLI** (on his
  ChatGPT $20 plan, whose limits he finds very generous); Opus reviews Luna's
  output and hands back corrections but does not implement. Evaluate whether
  this is good, what it would take, and risks. A foot in both ecosystems is a
  goal in itself.

## Brandon's answers to scoping questions (2026-09-12)

1. Deliverable: **(b)** a written retrospective committed to the repo (e.g.
   `docs/workplans/overnight-run-retro.md`). After his review it will likely be
   worked into `AGENTS.md` / `docs/development-workflow.md` in a later PR (c).
   Do not edit normative docs in this pass.
2. The Codex handoff should be **actually tested, not only researched** —
   specifically invoking `gpt-5.6-luna` at `xhigh`, because that is the model
   that would run. (See "Local vs cloud" below.)
3. Sending RuneSpace code to OpenAI via the Codex CLI is fine (he previously ran
   everything through ChatGPT desktop). Credentials (`dev.env`, `.env*`,
   auth files) are never shared regardless.
4. Budget: may run in the cloud. Keep Claude usage reasonable (the retro should
   not itself be an expensive run).
5. Brandon's own review found "mostly just normal things that always happen on
   follow ups, visual nitpicks" — e.g. the five PR #180 corrections (tinted
   guided buttons, weak map glow, a future Update timestamp, a stale
   `.qcfailed/status.json`, a missing `closes #176`).

## Local vs cloud

- A cloud session has the repo and GitHub, but **no** Codex CLI login, private
  `dev.env`, local Docker Postgres, or local transcripts. The data file carries
  the transcript-derived metrics.
- The live Codex/Luna trial must run on Brandon's laptop: Codex CLI
  `codex-cli 0.154.0` is installed and signed in; `~/.codex/config.toml`
  defaults to `model = "gpt-5.6-luna"`, `model_reasoning_effort = "xhigh"`;
  non-interactive `codex exec` with `-m` / `-c key=value` overrides exists. If
  the retro runs in the cloud, write the trial protocol and leave it for a local
  follow-up (or run it locally first).
- Suggested trial: one bounded, verifiable task with a known answer (e.g. a
  small unit test or doc fix on a scratch branch), invoked via `codex exec`,
  output captured, reviewed by Opus against the task, one correction round;
  record wall-clock, success, review burden, and whether AGENTS.md was honored.

## Starting observations (from the run; verify, don't assume)

Worked well: strictly sequential slices with per-slice PRs and `--no-ff`
merges; the durable ledger; plan-then-implement without blocking on approval;
rendered-pixel evidence and before/after proofs (a regression test proven to
fail on old code); diagnose-before-fix on every failure; exact-SHA preview
verification; zero-retry canonical E2E on the combined head; delegating
read-only surveys, unit tests, and docs to Sonnet with Opus review.

Cost/friction: ~86% of wall-clock was waiting (builds, E2E, CI); several
self-inflicted tooling incidents (plain `pnpm test:e2e` lacked the focused
runner's auth secret and deterministic-Mining flag; a `git stash` mid-build;
screenshots under the fixed footer); visual-judgement defects reached human
review (tinted guided buttons, subtle map glow, off-centre plate caught by
self-review); release-metadata misses (future Update timestamp, stale status
manifest, missing orchestration-issue close); most implementation stayed on
Opus rather than the cheaper model.

## Deliverable shape

`docs/workplans/overnight-run-retro.md`, concise and decision-oriented:
what to codify (candidate AGENTS.md/workflow rules, each with the incident that
motivates it), what to research/experiment (with a cheap experiment each),
metrics to track per run (and how to collect them), blind spots, and a
recommendation on the Pro + Codex/Luna split with a concrete handoff protocol
and its risks. Cite evidence (ledger sections, PRs, SHAs). Official plan/limit
facts must come from current official sources, dated; no guesses.
