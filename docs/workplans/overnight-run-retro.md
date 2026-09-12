# Overnight run retrospective (#176)

Retrospective on the 2026-09-12 overnight orchestration run: #173 → #143 →
#174 integrated sequentially into `staging/mission-guidance-cleanup`, then draft
review PR #180 and one human-review correction pass (`ec4d441`).

This is an internal working document, not a normative contract. Rules proposed
here are **candidates**; adopting them means a later PR editing `AGENTS.md` and
`docs/development-workflow.md`. Nothing here changes gameplay, persistence, or
player-facing behaviour.

Evidence: `docs/workplans/mission-guidance-cleanup-run.md` (the ledger),
`docs/workplans/overnight-run-data.md` (laptop-only metrics), PRs #177–#180,
issue #176, and the repository at `ec4d441`.

---

## 1. What the evidence actually says

The brief's starting observations were checked against the ledger, the PRs, the
CI runs, and the code. Most held. Three did not, and the corrections change the
conclusions.

### Confirmed

| Observation | Evidence |
| --- | --- |
| Strictly sequential slices, per-slice PR, `--no-ff` merge | Ledger "Slice status": `44ca235` → `058adfa` → `ab0e754` → `12de109`, PRs #177/#178/#179 |
| A regression test proven to fail on the old code | #173 execution log: same specs against pre-fix `app/globals.css` → **4 failed / 4 passed**, the four focus checks failing with 0 changed pixels |
| Diagnose before fix, every time | #143 Mining failure traced to a missing env flag, not patched away; #174 `data-mission-guidance` collision fixed in the component, not the test |
| Zero-retry canonical E2E on the combined head | Ledger final validation: `pnpm test:e2e:canonical` ✅ 83 passed, 0 retries, 215.8 s |
| Exact-SHA preview verification | `/api/build-info` `releaseId` = `12de1098767c46ac51e3e0c7ef95f01421800ede`, exact match with the PR head |
| Implementation stayed on the expensive model | Opus 245k output vs Sonnet 75k = **76.6% Opus** (data doc token table) |
| Self-inflicted tooling incidents | Three, all reproduced below in §2.1–§2.2 |

### Corrected

**"~86% of wall-clock was waiting (builds, E2E, CI)."** The 86% figure is real
but it is not machine wait. The data doc's own breakdown shows gaps over 2
minutes summing to 7.8 h of a 9.1 h span, of which **the single longest gap is
323 minutes (5.4 h)** — Brandon asleep or reviewing. Machine wait is the
remainder: roughly 2.4 h, about **26%** of the span.

CI corroborates this. Per-job timings across the seven workflow runs in the
chain give wall-clock of 3.1–3.7 minutes per run — about **21 minutes of CI
wall-clock in total**, against ~63 minutes of billed job-runner compute
(the canonical E2E matrix runs three shards in parallel). The local canonical
run was 215.8 s. CI was never the bottleneck.

> This matters because "86% waiting" invites the wrong fix (parallelise the
> slices, cut CI). The actual fix is different: see §5.1 on idle cost.

**"Per-slice PRs" were not a review gate.** #177, #178 and #179 were merged
**14 s, 4 s and 4 s** after being opened, by the same account that opened them,
with **zero reviews** on any of them. Their value was real but narrower than it
looks: per-slice CI, and a durable, reviewable diff boundary. They were never a
human checkpoint, and branch protection did not act.

**PR #180 is no longer a draft.** The title still reads "(DRAFT for review)"
and the ledger describes a draft whose Merge gate "is designed to remain
unsatisfied". As of 2026-09-12T19:29:04Z the PR carries `draft: false`,
`mergeable_state: clean`, and run `34714301638` on the same commit `ec4d441`
passed **including the Merge gate**. This is consistent, not contradictory:
`scripts/select-ci-gate.mjs` keys `merge_required` off GitHub's real `draft`
flag, so marking the PR ready for review flipped the gate. Brandon squash-merged
#180 at 2026-09-12T20:04:04Z; `main` is now `77a73df`, and issues #173, #143,
#174 and #176 close with it.

### Not previously noted, and material

**No human review exists anywhere in this chain as GitHub data.** All four PRs
return an empty review list. Brandon's preview review — the thing that produced
five corrections — survives only as prose inside an agent-authored PR comment
and the ledger's "PR #180 human-preview correction pass" section. The request
itself was never recorded verbatim. See rule C6.

**Two of the five corrections were visual; three were process/metadata.** The
framing "mostly visual nitpicks" undersells the mechanical half. Tinted guided
interiors and the weak map glow were judgement calls. The future Update
timestamp, the stale status manifest, and the missing `closes #176` were not —
each is checkable without an eye. See §2.3.

---

## 2. What to codify

Each candidate rule names the incident that motivates it. Nothing here is
adopted yet.

### 2.1 C1 — Name the sanctioned E2E runner; never `pnpm test:e2e` for guided or Mining specs

**Incidents (two, same root cause).** In #173, a plain `pnpm test:e2e` run had
every worker fail sign-in ("Worker authentication did not reach /characters").
In #143, `cut-your-teeth.spec.ts:212` expected "3 / 10" shale and got "1 / 10"
— a real, non-deterministic Mining roll.

**Root cause, verified in code.** `scripts/run-focused-e2e.mjs` sets
`BETTER_AUTH_SECRET` (line 106) and `RUNESPACE_E2E_MINING: "true"` (line 114).
`scripts/run-canonical-e2e.mjs` sets the same two (lines 243, 231). The
`pnpm test:e2e` path — `scripts/disposable-test-db.mjs` → `playwright test` —
sets **neither**. Both failures were the missing env, not the app.

**Why the agent used the trap command anyway.** `docs/testing-strategy.md:108`
positively recommends it: *"For focused local iteration, run the affected spec
(`pnpm test:e2e <spec> --project=chromium`)."* That contradicts line 34 and
line 114 of the same file, which point at `pnpm test:e2e:focused`.

**Candidate rule.** Plain `pnpm test:e2e` is not a sanctioned iteration command
for any spec that signs in or exercises Mining. Use `pnpm test:e2e:focused
<phase>`; if the spec has no phase, add one before iterating. Remove the
contradictory recommendation at `docs/testing-strategy.md:108`.

### 2.2 C2 — Every canonical spec must have a focused phase

**Incident.** The reason #143 and #174 fell back to the trap command at all:
`holo-hollow.spec.ts` is in the canonical allowlist
(`playwright.config.ts:26`, 15 specs) but is **not** in `FOCUSED_PHASES`
(`scripts/run-focused-e2e.mjs:45`, 9 phases). `account-news` has the same gap
and was likewise run plain during the correction pass. The agent had no
sanctioned way to iterate on the spec it had just written.

**Candidate rule.** Adding a spec to the canonical allowlist requires adding a
matching focused phase in the same PR. A lint or unit test can enforce the set
relation directly.

### 2.3 C3 — Mechanise the release-metadata checks that are mechanisable

**Incident.** Three of Brandon's five corrections were metadata:
a `following-the-job` Update dated `2026-09-12T20:00:00-07:00` — in the future
at review time; `.qcfailed/status.json` still showing #171 in `review` after
#171 merged at 2026-09-12T10:09Z; and a missing `closes #176` on the PR body.

**The asymmetry is already in the repo.** `tests/unit/qcfailed-status.test.ts`
defines `isRealNonFutureDate` (line 69) and applies it to
`latestCompleted.date`, `lastMeaningfulUpdate`, and every highlight
(lines 179, 185, 202). `features/public-site/public-updates.ts` validates
`publishedAt` for **uniqueness** (line 274) and offset format, but has **no
non-future guard** — and `tests/unit/public-updates.test.ts` has none either.
The manifest is protected against future dates; the Updates feed is not.

**Candidate rules.**
- Add a non-future guard on Update `publishedAt`, mirroring
  `isRealNonFutureDate`. This alone would have caught correction 4 locally.
  Note the News interaction the ledger found: `acknowledgeNews` writes the
  newest Update's `publishedAt` into `news_read_through_at` monotonically, so a
  future instant pushes a player's read boundary into the future. This is a
  correctness guard, not a tidiness one.
- Before opening an orchestration PR, re-read `.qcfailed/status.json` against
  the *current* merge state of the PR it names. A merge that lands during an
  overnight run silently invalidates the manifest.
- An orchestration PR body must carry `closes #<orchestration issue>` as well
  as the slice issues.

### 2.4 C4 — Guided controls: state the contract, don't re-judge it

**Incident.** Every guided `MissionActionButton` inherited a tinted caller
intent (`intent="mining"` → `rgba(245, 196, 81, 0.1)`; turn-in Talk →
`rgba(122, 91, 43, 0.24)`), and `.rs-bevel.rs-mission-*` added an inset
`0 0 16px` glow on top. The translucent fills let the exterior halo wash
through the interior; the controls read washed out beside the neutral Refresh
control. Screenshots existed. The agent looked at them and passed them.

**What the fix produced is already a written contract** — `docs/design-system.md`
now records that a guided control colours its text, its 2px inset edge ring and
its exterior halo, *never its interior* — and a generic regression:
`expectExteriorMissionHalo` asserts every guided control's background equals the
neutral `--rs-surface-control` surface (compared via a probe element, no literal
colour) and carries no blurred inset shadow.

**Candidate rule.** When a change introduces a new *visual state* on a shared
primitive, the acceptance evidence is an assertion against a named contract,
not a screenshot plus a judgement. Screenshots prove a thing rendered; they do
not prove it rendered correctly. Where no contract exists, write one before
implementing — that is the product-owner approval gate `AGENTS.md` already
requires for unresolved visual choices.

### 2.5 C5 — Capture the rendered-evidence hazards as a checklist

**Incidents.** `scrollIntoViewIfNeeded` left controls under the fixed bottom
navigation, so both screenshots captured the footer and the diff was 0 changed
pixels — a *passing-looking* result from a broken harness. Separately, a
`git stash` briefly reverted sources mid-build and aborted a run. Separately
again, the #143 map plate drifted right because `.rs-map-plate { position:
relative }` (later in `globals.css`) overrode a Tailwind `absolute`.

**Candidate rules.** Centre the element (`scrollIntoView({ block: "center" })`),
never `scrollIntoViewIfNeeded`, for any pixel diff. A pixel diff of exactly 0
is a harness failure until proven otherwise, not a pass. Never `git stash`
while a build is running. Remove temporary capture hooks before committing —
the run did this correctly both times and it should be written down.

### 2.6 C6 — Record human review feedback verbatim before acting on it

**Incident.** Brandon's preview review is nowhere in GitHub. Every PR in the
chain has zero reviews. The five corrections are known only through the
agent's own summary of them.

**Candidate rule.** Out-of-band review feedback is transcribed verbatim into
the ledger (and the PR) *before* any correction is made, attributed and dated.
The agent's reading of the request is recorded separately from the request. If
this run's judgement had been wrong, there would be no way to tell.

### 2.7 C7 — Assert the GitHub draft flag, don't infer it from the title

**Incident.** PR #180's title says "(DRAFT for review)" and the ledger reasons
throughout about "the draft-only Merge gate". Both were true at the time. But
draftness is a GitHub boolean that `scripts/select-ci-gate.mjs` reads directly,
and it changed without any commit: the PR is now `draft: false` with a green
Merge gate.

**Candidate rule.** When a run asserts "the Merge gate is intentionally
unsatisfied", record the PR's `draft` boolean alongside it, and re-read it
before drawing conclusions from a later run. A CI conclusion that changed on an
unchanged commit is a state change somewhere, and it is worth finding out where.

### 2.8 What already worked and should simply be written down

- The **durable ledger** is the single highest-value artefact of the run. A
  fresh session (this one) reconstructed the entire run from it with no access
  to the original conversation. Keep the shape: findings → plan → execution log
  → validation, per slice, with every SHA.
- **Plan-then-implement without blocking on approval**, with the plan committed
  first so a wrong direction is visible before the diff exists.
- **Strengthening superseded tests rather than deleting them.** #143 updated 8
  pre-existing unit tests to the refreshed contract, "each strengthened, none
  weakened"; #174 retargeted the terminology guard to the successor file with
  guard strength unchanged. This is the discipline that makes an autonomous run
  trustworthy, and it should be an explicit rule, not a habit.
- **Fixing the component, not the test**, when a new component broke an
  existing assertion (#174's `data-mission-guidance` collision).

---

## 3. What to research or experiment with

Each item has one cheap experiment with a decidable outcome.

**R1 — Does closing the focused-phase gap eliminate the trap?**
Experiment: add `holo-hollow` and `account-news` to `FOCUSED_PHASES` plus a
unit test asserting `canonical allowlist ⊆ focused phases`. Then check the next
run's ledger for any plain `pnpm test:e2e` invocation. One small PR; binary
answer.

**R2 — Can a written visual contract catch what the agent missed?**
Experiment: write the guided-control checklist (neutral interior; colour only
on text, edge ring, exterior halo; target contrast against the adjacent
unguided control and against the cyan map chassis). Hand it, plus the eight
`docs/screenshots/pr-180-corrections/` images with before/after labels
stripped, to a fresh session. Does it flag the two "before" images? Known
answer, no code, no CI.

**R3 — Where does the Opus spend actually go?**
Hypothesis from the data: not output. Opus produced 245k output tokens against
**64.3M cache-read tokens** over 174 turns — roughly 370k of context re-read
per turn. Cost tracks *turn count*, not code written.
Experiment: run one bounded slice under `claude -p --max-budget-usd` and
`--max-turns` and record turns, cache reads and cache misses from `/usage`.
If the ratio holds, any process change that adds turns (more handoffs, more
review rounds) costs more than moving implementation to a cheaper model saves.
This is the single most decision-relevant unknown in §6.

**R4 — How expensive are the idle gaps?**
The official Claude Code docs state that a first message after a break longer
than the cache lifetime reprocesses the full context, and that *"the lifetime
is an hour on a subscription"*. The run had 4 gaps over 10 minutes, the longest
323 minutes. Experiment: on the next long run, read the `/usage` behaviour
flags — cache misses are flagged when they account for ≥10% of recent usage —
and the `Prompt cache (main)` line in `/usage`, which reports misses, tokens
re-cached, and whether the cache is warm. Free; already instrumented.

**R5 — What should an overnight run do when it hits a usage limit?**
Not exercised in this run, and guaranteed to matter on a smaller plan. Claude
Code can *"wait and continue the interrupted task automatically after the
reset"* (v2.1.234+), controlled by `autoContinueAtUsageLimit` and
`/rate-limit-options`. Experiment: set it, start a long run deliberately close
to a limit, confirm the run resumes rather than dying at 3 a.m. with no human
present.

**R6 — The Codex/Luna trial.** See §7. It cannot run in the cloud.

---

## 4. Per-run metrics, and exactly how to collect each

The data doc says *"There is no built-in per-run or peak-window report;
transcript token counts are the only per-run source."* That is not quite right
— several of these are built in and were not used.

| Metric | Why it matters | How to collect |
| --- | --- | --- |
| **Orchestrator turns** | The real cost driver (§3 R3) | Count assistant turns in the session transcript, or read the turn count from the ledger if each turn is logged |
| **Cache reads, writes, misses** | A miss reprocesses the whole context | `/usage` → `Prompt cache (main)` line: request count, share of input from cache, misses, tokens re-cached, warm/cold |
| **Behaviour flags** | Names the dominant waste | `/usage` flags any behaviour (long context, cache misses) at ≥10% of recent usage |
| **Attribution by subagent / skill / MCP server** | Tells you whether delegation paid | `/usage` plan-usage breakdown, `d`/`w` for 24 h vs 7 d. Figures come from local session history on that machine only |
| **Spend ceiling actually hit** | Converts "was it expensive?" into a decision | `claude -p --max-budget-usd <n>`; subagent spend counts toward the cap, and the run stops at it. `--max-turns` for the turn analogue |
| **Model split (Opus vs Sonnet output)** | This run: 76.6% Opus | Transcript usage records deduplicated by message id, as the data doc did |
| **Friction pattern across runs** | Misunderstood requests, buggy code, rework | `/insights` — writes `~/.claude/usage-data/report.html`, analyses up to 200 unseen local sessions, keeps timestamped copies |
| **CI wall-clock vs CI compute** | 21 min vs 63 min here — very different stories | Per-job `started_at`/`completed_at` from the workflow run's jobs; the run's `updatedAt − createdAt` reflects the last job only |
| **Machine wait vs human wait** | Corrects the "86% waiting" error | Gap histogram between assistant turns, with gaps attributable to a sleeping human excluded explicitly |
| **Corrections per run, split by class** | This run: 2 visual, 3 mechanical | The ledger's correction-pass section, classified when written |
| **Rework rate: agent-caught vs human-caught** | This run: map plate and the `data-mission-guidance` collision caught by self-review; 5 reached Brandon | Same source; requires recording both, which the ledger already does |

Two collection caveats worth writing down: `/usage` figures are computed from
local session history on one machine, so a run that moves between machines
(as this one did) loses continuity; and `/insights` tokens count against the
plan like any other request.

---

## 5. Blind spots

**5.1 Idle is not free, and overnight is mostly idle.** The instinct from
"86% waiting" is to shorten the machine wait. But per the official docs the
subscription prompt-cache lifetime is one hour, and a gap longer than that
reprocesses the entire context on the next message. With ~370k of context per
turn, a handful of cold restarts is worth more than the entire CI budget. The
lever is not faster CI; it is *fewer cold starts* — batch the work so the
orchestrator either runs continuously or is deliberately parked.

**5.2 An overnight run has no defined abort condition.** Nothing in #176 or the
ledger says when the agent should stop and wait for a human rather than press
on. All three slices happened to succeed. The interesting question is what
would have happened at 3 a.m. on slice two if the semantic contract had turned
out to be ambiguous — and the answer is currently "whatever the agent decided".
Related: no usage-limit policy (§3 R5).

**5.3 The review trail is not auditable.** Zero GitHub reviews across four PRs;
self-merges 4–14 seconds after opening. For a solo pre-beta project this is a
reasonable trade, but it means "Brandon reviewed it" is not a fact the
repository can produce later. If the point of per-slice PRs is CI isolation and
a clean diff boundary, say so in `AGENTS.md`, so nobody later mistakes them for
a review gate that is not there.

**5.4 A future timestamp nearly reached player state.** The bad
`following-the-job` instant would have been written into
`news_read_through_at` monotonically. Production never saw it because #180 is
unmerged, but the ledger notes a disposable preview account that opened News
during review may still hold a boundary later than the corrected instant. The
class of bug — an agent writing a future-dated value into monotonic
player-visible state — is worth a guard (§2.3), not just a correction.

**5.5 Authorship is unfilterable.** Every commit in the chain is authored as
Brandon with a `Co-Authored-By` trailer; there is no distinct agent identity in
the GitHub data. Any future question of the form "how did agent-written changes
fare versus hand-written ones" cannot be answered from this repository's
history. Cheap to fix now, impossible to backfill later.

**5.6 The staleness the run correctly declined to fix is still stale.**
`docs/testing-strategy.md:38` still says "73 behavioral tests in 14 specs";
`playwright.config.ts:26` lists **15** specs and the canonical run passed
**83**. The run flagged it as pre-existing and out of scope, which was right
per `AGENTS.md` scope discipline. But nothing enforces the number, so it will
drift again. Either delete the count or assert it in a test.

**5.7 The meta-work is uncounted.** The retrospective, the brief, the data
export and this document are themselves orchestrator spend, and none of it
appears in any per-run metric. If the point of §4 is to decide where the
budget goes, process work has to be in the denominator.

---

## 6. Economics: Opus on Pro as orchestrator, Luna via Codex CLI as implementer

### 6.1 Verification status of the plan and pricing facts

**This section could not be completed to the standard the brief requires.** The
brief mandates that every plan, price or limit fact come from a current
official Anthropic or OpenAI source. This cloud session's network policy blocks
`www.anthropic.com`, `claude.com`, `support.claude.com`, `openai.com`,
`help.openai.com`, `developers.openai.com`, `platform.openai.com` and
`chatgpt.com` at the egress proxy. Third-party summaries of those pages were
returned by search and are **deliberately not used**.

Verified, from official sources reachable here:

| Fact | Source | Accessed |
| --- | --- | --- |
| Claude Code docs do **not** publish consumer plan prices; they defer to `claude.com/pricing` | <https://code.claude.com/docs/en/costs> | 2026-09-12 |
| Subscription prompt-cache lifetime is **one hour**; it drops to five minutes when drawing on usage credits | <https://code.claude.com/docs/en/costs> | 2026-09-12 |
| Session and weekly limits are seat-based windows shared across all models; `/model` does not restore access. Model-specific limits ("You've hit your Opus limit") *can* be worked around with `/model` | <https://code.claude.com/docs/en/costs> | 2026-09-12 |
| `autoContinueAtUsageLimit` / `/rate-limit-options` can wait for a reset and continue the interrupted task (v2.1.234+) | <https://code.claude.com/docs/en/costs> | 2026-09-12 |
| Usage credits let a Pro or Max subscriber continue past the included limit | <https://code.claude.com/docs/en/costs> | 2026-09-12 |
| `--max-budget-usd` caps spend in print mode; subagent spend counts toward the cap. `--max-turns` caps agentic turns | <https://code.claude.com/docs/en/cli-reference> | 2026-09-12 |
| Effort levels are `low, medium, high, xhigh, max, ultracode` | <https://code.claude.com/docs/en/cli-reference> | 2026-09-12 |
| Codex CLI is an OpenAI coding agent that runs locally; sign in with ChatGPT "to use Codex as part of your Plus, Pro, Business, Edu, or Enterprise plan" | <https://raw.githubusercontent.com/openai/codex/main/README.md> | 2026-09-12 |

**Not verified — do not treat the following as established:**

- The dollar price of Claude Pro, and of Claude Max 5x. Check
  <https://claude.com/pricing>.
- The ratio between Pro and Max 5x allowances. The "5x" in the product name
  implies one, but no reachable official page states it, and the retro's
  arithmetic must not assume it.
- Whether Opus is available on Pro at all, and under what model-specific limit.
  Check <https://claude.com/pricing> and
  <https://support.claude.com/en/articles/8325606-what-is-the-pro-plan>.
  **This is the load-bearing fact for the whole proposal** — the plan is
  "Opus as orchestrator on Pro", and if Opus access or its limit on Pro is
  narrow, the shape changes.
- The dollar price of ChatGPT Plus, and Codex usage limits on it. Check
  <https://openai.com/chatgpt/pricing/> and
  <https://help.openai.com/en/articles/11369540-codex-in-chatgpt>.
- Anything about `gpt-5.6-luna` as a model: capability, context window,
  availability, or what `xhigh` reasoning effort means for it. The only
  evidence in hand is that Brandon's `~/.codex/config.toml` names it as the
  default with `model_reasoning_effort = "xhigh"` and that the CLI accepts it —
  which establishes that his account can select it, and nothing else. Check
  <https://developers.openai.com/codex>.

Brandon or a local session should fill these in; the recommendation below is
structured so that only the *magnitude* depends on them, not the direction.

### 6.2 Recommendation: yes, with one important correction to the reasoning

**Provisional — pending the §7 trial and the unverified facts above.**

The split is worth doing. But the stated rationale — hand implementation to the
cheaper model to save money on the expensive one — is probably wrong about
where the money goes, and getting this right determines whether the split
actually saves anything.

**The finding.** Opus's spend on this run was not implementation. It was
**245k output tokens against 64.3M cache-read tokens across 174 turns** — a
ratio of roughly 260:1. Approximately 370k of context was re-read on every
turn. The tokens went into *carrying the conversation*, not into writing code.

Moving implementation to Luna does not remove that. The orchestrator still
holds the whole run in context; it now additionally writes task packets and
reviews diffs it did not author, which it previously got for free as a
by-product of writing them.

**So the saving, if it exists, comes from reducing orchestrator turns — not
from reducing orchestrator output.** That gives a sharp design rule:

> Hand off **few, large, self-contained** tasks. Every additional handoff,
> clarification, or correction round is a full-context orchestrator turn and
> costs more than the code it produces.

A split that produces 3 handoffs per slice is likely cheaper than doing it in
Claude. A split that produces 15 is likely more expensive, even though Luna's
tokens are free at the margin on a flat ChatGPT plan.

**The second, non-economic reason to do it anyway, which is stronger.** Brandon
names a foot in both ecosystems as a goal in itself. On a plan with a hard
weekly cap, the binding constraint is not dollars, it is *the run dying
mid-flight*. Luna capacity on a separate subscription is a second, independent
budget. Its value is that it decouples implementation throughput from the
Claude weekly limit — insurance, not savings. That is worth having regardless
of how the token arithmetic lands.

**The structural advantage RuneSpace already has.** `CLAUDE.md` is a symlink to
`AGENTS.md` — one contract file, in exactly the filename Codex CLI already
loads. There is no second contract to maintain, no drift between what Claude is
told and what Luna is told. Most repositories attempting this split have to
build that; RuneSpace has it.

### 6.3 What it would take

1. **Verify the facts in §6.1**, especially Opus availability and limits on Pro.
2. **Run the §7 trial.** One bounded task with a known answer. Do not restructure
   the workflow before there is evidence Luna honours `AGENTS.md`.
3. **Fix the focused-phase gap (C2/R1) first.** Luna will need a sanctioned way
   to prove its own work locally, and handing it the trap command reproduces
   §2.1's incidents with less context to recover from.
4. **Write the task-packet template** (§6.5) and the never-touch list (§6.6).
5. **Set a turn budget per handoff** and record it. If a task exceeds two
   correction rounds, pull it back rather than iterating — by R3's arithmetic,
   the third round costs more than implementing it in Claude would have.

### 6.4 Risks

| Risk | Why it bites here | Mitigation |
| --- | --- | --- |
| **Review burden exceeds the saving** | The central risk, per §6.2. Opus must now read diffs it did not write, at full context cost | Turn budget per handoff; pull back after two correction rounds; measure turns, not tokens (R3) |
| **AGENTS.md is long and strict** | 178 lines of boundaries, SSOT rules, scope discipline, pre-beta data policy. A model that partially honours it produces plausible diffs that violate architecture — the most expensive failure mode to catch by review | Trial explicitly scores AGENTS.md adherence (§7); never-touch list is enforced by review, not trust |
| **Semantic-contract drift** | #176's "blue = Mission boundary, green = accepted work" is not derivable from the code. An implementer that re-derives it from CSS will get it wrong | Restate the contract verbatim in every task packet that touches Mission presentation |
| **Two harnesses, one repo, no shared memory** | Luna will not know what the orchestrator decided three slices ago | The ledger is the shared memory. Give Luna the relevant ledger section, not the conversation |
| **Loss of diagnose-before-fix** | The run's best habit. A bounded implementer under time pressure patches the test | Never-touch list includes test weakening; the correction round checks for it explicitly |
| **Code leaves the Claude ecosystem** | Accepted by Brandon; credentials excluded regardless | `dev.env`, `.env*` and auth files are never in a task packet and never in Codex's working set |
| **Unverified plan limits** | The proposal may be sized against a Pro Opus allowance that does not exist in the assumed form | §6.1; verify before restructuring |

### 6.5 Handoff protocol

**Task packet (Opus writes, one file, self-contained).** Luna gets this and the
repository — not the conversation.

1. **Goal** — one paragraph, in terms of observable behaviour.
2. **Boundary** — the exact files Luna may create or modify, as paths. Anything
   not listed is out of bounds.
3. **Contract** — the relevant rules restated verbatim: the semantic contract
   if Mission presentation is involved, the SSOT owner of each fact being
   touched, and the relevant `docs/` section. Do not link; quote.
4. **Known answer** — the test, assertion, or rendered contract that decides
   success. If there is no decidable success condition, the task is not
   boundable and should not be handed off.
5. **Validation command** — the exact sanctioned command, with the phase name.
6. **Never touch** — §6.6, inline.
7. **Ledger context** — the relevant ledger section only.

**Review loop (Opus reviews, does not implement).** Rubric, in order; stop at
the first failure and return it:

1. Did it stay inside the boundary? (`git diff --stat` against the named paths.)
2. Does the known answer pass, under the sanctioned command?
3. Does it violate any never-touch item?
4. Does it violate an architectural boundary — logic in React, duplicated
   SSOT, a rule in a component, a new dependency?
5. Was any existing test weakened, skipped, or deleted rather than
   strengthened?
6. Does it match the contract quoted in the packet, including visual contracts
   (C4: neutral interior, colour on text/ring/halo only)?
7. Only then: is it good code?

**Correction round — exactly one.** Opus returns a numbered list of concrete
required changes, each citing the rubric item it failed. No open-ended
feedback, no "consider". If the second submission still fails, Opus pulls the
task back and implements it, and the ledger records the pull-back — that is the
datum that tells you whether the split is working.

**Ledger entry per handoff:** packet path, model and effort, wall-clock,
rubric result, correction rounds used, pulled back yes/no.

### 6.6 What Luna must never touch

Hard boundary. Any diff touching these is returned unreviewed.

- `dev.env`, `.env*`, `~/.codex/auth.json`, any credential or auth file.
- `main`, and any push, merge, or force-push to any branch. Luna commits to the
  working branch it was given; the orchestrator handles git.
- `AGENTS.md` / `CLAUDE.md`, and everything in `docs/` that is normative
  (`development-workflow.md`, `testing-strategy.md`, `architecture.md`,
  `component-boundaries.md`, `game-rules.md`, `missions.md`, `design-system.md`,
  `deployment-database.md`).
- `.qcfailed/status.json`, public Updates (`features/public-site/`), and the
  public Wiki. These carry release semantics and publication timing; §2.3
  showed how easily they go wrong.
- `db/` migrations and `drizzle/`. Schema changes are orchestrator work.
- Game mechanics, balance, content, lore, NPCs, quests, resources, or visual
  direction not already authored. `AGENTS.md` forbids inventing these, and a
  bounded implementer is the worst possible place to decide them.
- The canonical E2E allowlist (`playwright.config.ts`) and CI workflow
  (`.github/workflows/ci.yml`, `scripts/select-ci-gate.mjs`).
- Any existing test, except to strengthen it to a contract stated in the packet.
  Weakening, skipping, deleting or retargeting a test is orchestrator work.
- The production or preview database, Coolify, and anything under
  `scripts/` that talks to a database.

---

## 7. Local trial protocol (pending)

**This has not been run.** It requires Brandon's signed-in Codex CLI. This
cloud session has no Codex login, no `~/.codex/config.toml`, and no local
`dev.env`, and did not attempt to simulate any of it. The §6.2 recommendation
is provisional until this completes.

Run it on the laptop, in order. Total expected time well under an hour.

### Step 0 — Preconditions

```bash
codex doctor
codex --version          # expect codex-cli 0.154.0 or later
cat ~/.codex/config.toml # confirm model + model_reasoning_effort
cat ~/.codex/AGENTS.md   # global Codex instructions — read before judging adherence
```

Read `~/.codex/AGENTS.md` first. If it contains instructions that conflict with
the repository's `AGENTS.md`, the trial measures the wrong thing; note the
conflict and resolve it before proceeding.

### Step 1 — Scratch branch

```bash
cd /path/to/RuneSpace
git fetch origin
git checkout -B scratch/luna-trial-001 origin/main
```

Never run the trial on `staging/mission-guidance-cleanup` or any branch with
real work on it.

### Step 2 — The bounded task, with a known answer

Use C3's gap. It is small, real, has an unambiguous correct answer, is covered
by a fast local command, and touches nothing on the never-touch list.

> **Task.** `features/public-site/public-updates.ts` validates public Update
> `publishedAt` values for uniqueness and offset format, but does not reject a
> `publishedAt` in the future. `tests/unit/qcfailed-status.test.ts` already
> solves the analogous problem with its `isRealNonFutureDate` helper.
> Add a non-future guard to the public Updates validator, and a unit test in
> `tests/unit/public-updates.test.ts` proving a future `publishedAt` is
> rejected and that the eight currently authored Updates still validate.
>
> **Boundary.** Modify only `features/public-site/public-updates.ts` and
> `tests/unit/public-updates.test.ts`. Create no new files.
>
> **Known answer.** `pnpm test tests/unit/public-updates.test.ts` passes, the
> new test fails if the guard is removed, and `pnpm typecheck`, `pnpm lint`
> and `pnpm format:check` are clean.
>
> **Never touch.** Everything in §6.6. In particular: do not change any
> authored Update's content or `publishedAt`, and do not weaken an existing
> assertion.

Write that into `/tmp/luna-trial-001-packet.md` using the §6.5 template, with
the never-touch list inline.

### Step 3 — Invoke

```bash
mkdir -p /tmp/luna-trial-001

/usr/bin/time -p codex exec \
  -m gpt-5.6-luna \
  -c model_reasoning_effort=xhigh \
  "$(cat /tmp/luna-trial-001-packet.md)" \
  2>&1 | tee /tmp/luna-trial-001/transcript.txt
```

Capture the diff and the state separately, so the review is against artefacts
rather than the transcript:

```bash
git --no-pager diff > /tmp/luna-trial-001/round1.diff
git --no-pager diff --stat | tee /tmp/luna-trial-001/round1.stat
pnpm typecheck 2>&1 | tee /tmp/luna-trial-001/round1-typecheck.txt
pnpm lint 2>&1 | tee /tmp/luna-trial-001/round1-lint.txt
pnpm format:check 2>&1 | tee /tmp/luna-trial-001/round1-format.txt
pnpm test tests/unit/public-updates.test.ts 2>&1 | tee /tmp/luna-trial-001/round1-test.txt
```

Then prove the test actually detects the bug — the #173 discipline:

```bash
# revert only the validator, keep the new test, re-run: the new test must fail
git stash push features/public-site/public-updates.ts   # NOT during a build (C5)
pnpm test tests/unit/public-updates.test.ts 2>&1 | tee /tmp/luna-trial-001/round1-proof.txt
git stash pop
```

### Step 4 — Opus review

Give Opus `round1.diff`, the four command outputs, the proof output, and the
packet. Score the §6.5 rubric in order, and record for each item: pass, fail,
or not applicable. Explicitly answer:

- Did it stay inside the two named files?
- Does the new test fail when the guard is reverted?
- Did it reuse the existing `isRealNonFutureDate` shape, or invent a parallel
  one? (An SSOT question — the interesting one.)
- Did it touch any authored Update's `publishedAt`?

### Step 5 — One correction round

If anything failed, return a numbered list of required changes, each citing its
rubric item. Re-invoke with the same command, appending the correction list.
Capture as `round2.*`. **Stop after this round** whatever the outcome.

### Step 6 — Record

Write results to `docs/workplans/luna-trial-001.md` and link it from this
document's §6.2. Record:

- Wall-clock for each invocation (from `/usr/bin/time -p`), and Opus review
  time separately.
- Success: did the known answer pass, and did the proof step confirm the test
  detects the bug?
- Review burden: rubric items failed, correction rounds used, and how many
  orchestrator turns the review itself took (the R3 metric).
- **AGENTS.md adherence**, itemised: boundary respected; no test weakened; SSOT
  respected; no never-touch violation; scope not expanded; no invented
  mechanics. A single yes/no is not useful here.
- Anything Luna did that the packet did not anticipate — in either direction.

Then update §6.2 from provisional to a decision, and delete the scratch branch.

---

## 8. Top three, if only three things happen

1. **Close the focused-phase gap (C2) and remove the contradictory
   recommendation at `docs/testing-strategy.md:108` (C1).** Two of the run's
   three tooling incidents came from one missing list entry, and the docs
   actively pointed at the trap.
2. **Add the non-future guard on Update `publishedAt` (C3).** It is the one
   correction from Brandon's review that a machine could have caught, it is a
   correctness guard because of `news_read_through_at` monotonicity, and the
   pattern to copy is already in `tests/unit/qcfailed-status.test.ts`.
3. **Measure orchestrator turns before restructuring around Luna (R3).** The
   economics of §6 turn on whether cost tracks turns or output. The data says
   turns, by a factor of 260. If that holds, the handoff protocol's "few,
   large" rule is the whole ballgame, and a chatty split would cost more than
   it saves.
