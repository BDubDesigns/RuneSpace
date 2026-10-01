# Moderation, Sanctions, Privileged Access, and Appeals (Issue #248)

This is the authoritative contract for how RuneSpace operators review player
reports, sanction accounts, and answer appeals, and for how every privileged
view of sensitive safety data is audited. It builds on Block and Report
(#247, `docs/architecture.md`), the Operator Console (`docs/admin-console.md`),
and the gameplay-access rule (`docs/gameplay-access.md`). The product decisions
come from planning issue #226.

Human judgement is the authority. Nothing in RuneSpace scores a player,
reads a hidden threshold, or warns, restricts, or suspends anyone
automatically. Reports and blocks are interpretable context for a person.

## Player-facing policies

Both are Wiki articles in the **Community & Safety** category
(`features/public-site/public-wiki.ts`), linked from every public page's
footer, the Chat/Social panel, every sanction notice, and the "Open Channels"
Update. Their slugs live in `features/public-site/policy-links.ts`.

- **Chat & Community Rules** (`/wiki/community-rules`) — the locked #226 copy,
  in its casual tone. Do not rewrite it into legal or HR voice.
- **Safety & Privacy** (`/wiki/safety-and-privacy`) — what is stored, why, for
  how long, who can see it, and how notices and appeals work. Every sentence
  must stay true to shipped storage and access. **Update it first** whenever
  RuneSpace collects a materially new kind of safety data or uses it for a new
  purpose. Never publish thresholds, signal weights, prioritization logic, or
  anything else that would help someone evade enforcement or brigade another
  player.

## Moderation cases

`moderation_cases` (`db/rune-space.ts`) is the unit an operator reviews. Each
case is about one **subject account** — the safety identity behind every
character — and moves Open → Reviewed → Actioned or Dismissed
(`game/domain/moderation.ts`).

- **Reports join cases.** `caseForNewReport` (`server/moderation-cases.ts`),
  called inside the report's own transaction, attaches each report to its
  subject's one Open-or-Reviewed case (a partial unique index admits one) or
  opens a new case. A report after a case is Actioned or Dismissed opens a
  fresh case rather than reopening a decided one. Joining never changes a
  case's status. A duplicate report stores nothing and leaves no empty case.
- **Operator-opened cases.** From the character inspector an operator may open
  a case on that character's account with a stated reason, for an
  investigation no report started. If the account already has an active case,
  that case is returned instead.
- **Reference.** `case_number` is the durable source of the player-facing
  reference `MOD-00042` that notices and appeals cite.
- **Notes** (`moderation_case_notes`) are append-only and internal.
- Cases, reports, evidence, notes, sanctions, and appeals are **never deleted**
  — a permanent suspension keeps all of it. Report evidence is a snapshot, so
  it outlives ordinary 90-day chat retention.

Migration `0034_moderation_review_sanctions` backfills every report filed
before cases existed into one Open, report-opened case per reported account,
then makes `player_reports.case_id` required.

### What the case view shows, in order

The Operator Console case page (`/admin/moderation/{caseId}`) renders, in the
review order the issue requires: the reported content and allegation; the
preserved context (up to 10 messages before and after, from that feed or that
one Whisper conversation); stable identities of the subject and each reporter;
recent reports against the account (count and distinct reporting accounts over
30 days, plus its other cases); block context (distinct accounts blocking it
now, and distinct accounts that blocked it in 30 days); whether each reporter
blocks it; on explicit request, retained chat around the incident; and the
names its characters were seen under. Then notes, sanctions with appeals, and
the case's own action history. Counts are shown as counts — there is no score,
ratio, or risk level.

### Retained chat — the legitimate-access boundary

Beyond a report's preserved evidence, retained messages are reachable only
from a case, only per report, and only on an explicit operator action:

- **Retained General/Trade** — the subject account's own public messages in a
  24-hour window centred on the report.
- **Retained Whispers** — only conversations between the report's two
  accounts (reporter and subject), in the same window. No other conversation of
  either account is ever read.

There is no tool for browsing an account's Whispers, and no path to Whisper
content that does not start from a report on a case.

## Sanctions

`moderation_sanctions` records an operator's explicit action on a case against
its subject account. Sanctions are **account-wide** by construction: they are
stored against the account, so every character is covered and switching
characters never evades one.

| Kind | Effect while in effect | Enforced at |
| --- | --- | --- |
| Warning | None; a notice on record | — |
| Social restriction | No General, Trade, promoted Trade ads, or Whispers; no starting a player trade request | `beginChatSend` (every chat send, `server/chat.ts`); `requireTradeRequestInitiationAllowed` (`server/moderation-sanctions.ts`), called by `createTradeRequest` (`server/player-trades.ts`, #266) |
| Account suspension | No gameplay on any character | `decideGameplayAccess` via `server/gameplay-access.ts` |

- **Durations:** 24 hours, 7 days, 30 days, 90 days, 1 year, or permanent
  (`SANCTION_DURATIONS`). A warning has none. `ends_at` is derived from
  `starts_at` and the preset; changing the duration re-derives it from the
  original start.
- **No stored "active" flag.** Whether a sanction is in effect is derived on
  every check from its facts and the request clock (`sanctionState`), so expiry
  needs no job and reversal applies on the next request. A sanction stops
  applying at its exact `ends_at`.
- **A socially restricted player** keeps ordinary gameplay, reading public
  chat, reporting, blocking, and accepting a trade request someone else
  starts (#266). Issuing or changing a sanction takes the subject's chat send
  lock, so a send already in flight commits before the restriction and none
  after it.
- **A suspended account** is refused by every gameplay command, gameplay read,
  and realtime stream, and returns to Characters. After a suspension changes,
  the account's open streams are closed so each reconnect re-runs
  authorization.
- **No Shadowlands.** Nothing silently segregates or hides a sanctioned
  player; every sanction is explicit, noticed, auditable, and reversible.
- A case may hold only one in-effect sanction of each non-warning kind: change
  its duration instead of stacking another. Issuing a sanction marks the case
  Actioned.

`requireTradeRequestInitiationAllowed(executor, playerAccountId, now)` is the
seam `createTradeRequest` (`server/player-trades.ts`, #266) calls inside its
transaction, next to the Block seam `blockBetween`. Accepting a request is
not gated by it. Since #268 players start trades from a profile, so
`SANCTION_ACCESS_AFFECTED` names starting a trade (and keeps accepting one),
and the Safety & Privacy page describes the trade records RuneSpace keeps.

## Player notices and appeals

`server/moderation-notices.ts` is account management, not gameplay: it needs
only a session and the player's own account, so a suspended player can still
read a notice and appeal. Every read is scoped to that account.

- A notice (`SanctionNoticeView`) carries the kind, the rule category and a
  link to the Community Rules, what access is affected, the duration and end,
  the case reference, its state, and its appeal status — and nothing else: no
  reporter, no moderator, no internal note, no count or signal.
- **Where players see it:** a callout on Characters for each current notice
  (in effect, or a warning issued in the last 30 days); for a suspended account
  that callout replaces the Soft Alpha, Play, Reserve, and New character
  treatments. In Play, each current notice is a pinned "Moderation notice"
  card in Chat/Social for as long as it is current, and a social restriction
  holds the composers' Send. The card lights the Chat/Social launcher only
  until the open panel has shown it: that acknowledgement is presentation
  kept on the device (`features/moderation/notice-acknowledgement.ts`, keyed
  by sanction and end, so a changed duration asks again), not moderation
  state, and it never touches durable Whisper unread. All
  notices are listed at `/moderation`; `/moderation/{sanctionId}` shows one
  with its appeal form. The server pushes `"moderation.notices"` to the
  account's tabs after any sanction or appeal change.
- **Appeal:** one per sanction (`moderation_appeals.sanction_id` is unique),
  while the sanction still stands (in effect, or an unreversed warning). The
  player writes up to 1,000 characters; no attachments, email, helpdesk, or
  public thread. The submission is never changed.
- **Decision:** in the case view the operator Upholds, Modifies (a new
  duration), or Reverses. The decision and any resulting sanction change commit
  together, and a decided appeal cannot be decided again.

## Audit

Two separate append-only records, because they mean different things:

- **`operator_audit_logs`** — successful mutations, as before. The seven
  moderation operations (`open_moderation_case`,
  `set_moderation_case_status`, `add_moderation_case_note`,
  `issue_moderation_sanction`, `change_moderation_sanction_duration`,
  `reverse_moderation_sanction`, `decide_moderation_appeal`) target the case
  subject's `player_account` and carry `moderation_case_id`. An appeal
  decision that modifies or reverses its sanction writes the sanction row too,
  with the appeal id. No-ops write nothing. These rows appear only in their
  case's history — the inspector's account history excludes them, because
  viewing them is itself audited.
- **`privileged_access_logs`** — every operator **view** of sensitive safety
  data, even with no action: the moderation queue (`case_queue`), a case
  (`case_detail`), retained public chat (`retained_public_chat`), retained
  Whispers (`retained_whispers`, with the conversation ids), an account's
  moderation history (`account_moderation_history`), and this log itself
  (`privileged_access_log`). Each row records the server-derived admin id,
  time, case and target account/character where applicable, and what exactly
  was viewed (filters, windows, ids — never the data). It is written in the
  same transaction as the read, before any sensitive data is read, so a failed
  audit returns nothing.

Neither table has an update or delete path anywhere in the application, and
only allowlisted operators can read them. Moderation reads and mutations use
the same production stance as the rest of the console:
`server/moderation-commands.ts` calls `requireAdmin(headers)` and then the
internal seam in `server/moderation-seams.ts`, so the actor is always the
Better Auth session's user and a non-admin gets a 403 with no data and no
audit row naming them.

Moderator roles and delegated player moderators are out of scope; if they are
added later, they must go through the same access audit.

## Tests

- Unit: `tests/unit/moderation.test.ts` (sanction state, durations, notices,
  labels, and the production surface's `requireAdmin` guard),
  `tests/unit/gameplay-access.test.ts` (suspension outranks every grant),
  `tests/unit/operator-audit-target.test.ts`,
  `tests/unit/gameplay-entrypoints.test.ts` (moderation pages classified).
- PostgreSQL: `tests/integration/moderation.test.ts` (authorization, access
  audit, cases, sanctions on every character, expiry and reversal, appeals) and
  `tests/integration/moderation-migration.test.ts` (0034 backfill).
- Browser: `tests/e2e/moderation.spec.ts` (report → case → sanction → notice →
  appeal → decision, access-log entries, suspension, and the published
  policies and Update).
