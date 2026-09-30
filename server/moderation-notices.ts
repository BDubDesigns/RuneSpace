import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import {
  moderationAppeals,
  moderationCases,
  moderationSanctions,
  type ModerationAppeal,
  type ModerationSanction,
} from "@/db/rune-space";
import { COMMUNITY_RULES_PATH } from "@/features/public-site/policy-links";
import {
  APPEAL_POLICY,
  isSanctionAppealable,
  isSanctionNoticeCurrent,
  moderationCaseReference,
  MODERATION_RULE_LABEL,
  normalizeModerationText,
  SANCTION_ACCESS_AFFECTED,
  SANCTION_KIND_LABEL,
  sanctionDurationLabel,
  sanctionState,
  type AppealOutcome,
  type ModerationRuleCategory,
  type SanctionDuration,
  type SanctionFacts,
  type SanctionKind,
} from "@/game/domain/moderation";
import type {
  AppealStatusView,
  SanctionNoticeView,
  SanctionNoticesView,
  SubmitAppealResult,
} from "@/game/schemas/moderation";
import { requirePlayerAccount } from "@/server/ownership";

/**
 * What a sanctioned player sees, and their appeal (issue #248).
 *
 * This is account management, not gameplay: it needs only an authenticated
 * session and the player's own account, so a suspended player can still read
 * their notice and appeal without entering Play. Every read is scoped to the
 * session's own account; another account's sanction id is simply not found.
 *
 * A notice tells the player the rule, the access affected, the duration, the
 * case reference, and how to appeal — and nothing else: no reporter, no
 * moderator, no internal note, no signal, and no threshold.
 */

type Row = {
  sanction: ModerationSanction;
  caseNumber: number;
  appeal: ModerationAppeal | null;
};

function facts(sanction: ModerationSanction): SanctionFacts {
  return {
    kind: sanction.kind as SanctionKind,
    startsAt: sanction.startsAt,
    endsAt: sanction.endsAt,
    reversedAt: sanction.reversedAt,
  };
}

function appealStatus(appeal: ModerationAppeal | null): AppealStatusView {
  if (!appeal) return { status: "none" };
  if (appeal.outcome === null || appeal.decidedAt === null) {
    return { status: "pending", submittedAt: appeal.submittedAt.toISOString() };
  }
  return {
    status: "decided",
    submittedAt: appeal.submittedAt.toISOString(),
    decidedAt: appeal.decidedAt.toISOString(),
    outcome: appeal.outcome as AppealOutcome,
  };
}

function toNotice({ sanction, caseNumber, appeal }: Row, now: Date): SanctionNoticeView {
  const kind = sanction.kind as SanctionKind;
  const ruleCategory = sanction.ruleCategory as ModerationRuleCategory;
  const sanctionFacts = facts(sanction);
  return {
    sanctionId: sanction.id,
    caseReference: moderationCaseReference(caseNumber),
    kind,
    kindLabel: SANCTION_KIND_LABEL[kind],
    ruleCategory,
    ruleLabel: MODERATION_RULE_LABEL[ruleCategory],
    rulesHref: COMMUNITY_RULES_PATH,
    accessAffected: SANCTION_ACCESS_AFFECTED[kind],
    durationLabel: sanctionDurationLabel(kind, sanction.duration as SanctionDuration | null),
    startsAt: sanction.startsAt.toISOString(),
    endsAt: sanction.endsAt ? sanction.endsAt.toISOString() : null,
    state: sanctionState(sanctionFacts, now),
    current: isSanctionNoticeCurrent(sanctionFacts, now),
    appealable: appeal === null && isSanctionAppealable(sanctionFacts, now),
    appeal: appealStatus(appeal),
  };
}

const rowSelection = {
  sanction: moderationSanctions,
  caseNumber: moderationCases.caseNumber,
  appeal: moderationAppeals,
};

/** Every sanction on the player's own account, newest first. */
export async function loadSanctionNotices(
  userId: string,
  now: Date = new Date(),
): Promise<SanctionNoticesView> {
  const account = await requirePlayerAccount(userId);
  const rows = await db
    .select(rowSelection)
    .from(moderationSanctions)
    .innerJoin(moderationCases, eq(moderationCases.id, moderationSanctions.caseId))
    .leftJoin(moderationAppeals, eq(moderationAppeals.sanctionId, moderationSanctions.id))
    .where(eq(moderationSanctions.playerAccountId, account.id))
    .orderBy(desc(moderationSanctions.startsAt), desc(moderationSanctions.id));
  return { notices: rows.map((row) => toNotice(row, now)) };
}

/** One sanction on the player's own account, or null (never another account's). */
export async function loadSanctionNotice(
  userId: string,
  sanctionId: string,
  now: Date = new Date(),
): Promise<SanctionNoticeView | null> {
  const { notices } = await loadSanctionNotices(userId, now);
  return notices.find((notice) => notice.sanctionId === sanctionId) ?? null;
}

const NOT_APPEALABLE = "This notice can't be appealed.";

/**
 * Submit the one appeal a sanction allows: a short explanation of why the
 * player wants it reviewed. The stored submission is never changed; an
 * operator decides it once in the Operator Console, and that decision is
 * audited there.
 */
export async function submitAppeal(
  userId: string,
  request: { sanctionId: string; body: string },
  now: Date = new Date(),
): Promise<SubmitAppealResult> {
  const account = await requirePlayerAccount(userId);
  const body = normalizeModerationText(request.body, APPEAL_POLICY.bodyMaxLength);
  if (!body.ok) {
    return {
      error:
        body.reason === "empty"
          ? "Tell us why you want this reviewed."
          : `Appeals can be up to ${APPEAL_POLICY.bodyMaxLength} characters.`,
    };
  }
  const result = await db.transaction(async (tx) => {
    const [sanction] = await tx
      .select()
      .from(moderationSanctions)
      .where(eq(moderationSanctions.id, request.sanctionId))
      .limit(1)
      .for("update");
    if (!sanction || sanction.playerAccountId !== account.id) return { error: NOT_APPEALABLE };
    if (!isSanctionAppealable(facts(sanction), now)) {
      return { error: "This sanction is no longer in effect, so there's nothing to appeal." };
    }
    const inserted = await tx
      .insert(moderationAppeals)
      .values({
        sanctionId: sanction.id,
        caseId: sanction.caseId,
        playerAccountId: account.id,
        body: body.text,
        submittedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: moderationAppeals.id });
    if (inserted.length === 0) return { error: "You've already appealed this. We'll review it." };
    return { ok: true as const };
  });
  if ("error" in result) return { error: result.error! };
  const notice = await loadSanctionNotice(userId, request.sanctionId, now);
  if (!notice) return { error: NOT_APPEALABLE };
  return { status: "submitted", notice };
}
