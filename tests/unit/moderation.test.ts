import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { decideGameplayAccess } from "@/game/domain/gameplay-access";
import {
  ACTIVE_CASE_STATUSES,
  APPEAL_OUTCOMES,
  APPEAL_OUTCOME_LABEL,
  MODERATION_CASE_STATUSES,
  MODERATION_CASE_STATUS_LABEL,
  MODERATION_RULE_CATEGORIES,
  MODERATION_RULE_LABEL,
  PRIVILEGED_ACCESS_KINDS,
  PRIVILEGED_ACCESS_LABEL,
  SANCTION_ACCESS_AFFECTED,
  SANCTION_DURATIONS,
  SANCTION_DURATION_KEYS,
  SANCTION_DURATION_LABEL,
  SANCTION_KINDS,
  SANCTION_KIND_LABEL,
  WARNING_NOTICE_WINDOW_MS,
  hasSanctionInEffect,
  isActiveCaseStatus,
  isSanctionAppealable,
  isSanctionNoticeCurrent,
  moderationCaseReference,
  normalizeModerationText,
  sanctionDurationLabel,
  sanctionEndsAt,
  sanctionState,
  type SanctionFacts,
} from "@/game/domain/moderation";

/**
 * Issue #248 — the pure moderation rules: how a sanction's state derives from
 * its persisted facts and the request clock, who may appeal, what a notice
 * surfaces, and the labels every category has. Server enforcement and the
 * PostgreSQL behaviour are proven in `tests/integration/moderation.test.ts`.
 */

const HOUR_MS = 60 * 60_000;
const DAY_MS = 24 * HOUR_MS;
const START = new Date("2026-09-01T12:00:00.000Z");
const at = (ms: number) => new Date(START.getTime() + ms);

function restriction(overrides: Partial<SanctionFacts> = {}): SanctionFacts {
  return {
    kind: "social_restriction",
    startsAt: START,
    endsAt: at(DAY_MS),
    reversedAt: null,
    ...overrides,
  };
}

describe("sanctionState", () => {
  it("takes effect when issued and ends at its exact end instant", () => {
    const sanction = restriction();
    expect(sanctionState(sanction, START)).toBe("in_effect");
    expect(sanctionState(sanction, at(DAY_MS - 1))).toBe("in_effect");
    expect(sanctionState(sanction, at(DAY_MS))).toBe("expired");
    expect(sanctionState(sanction, at(DAY_MS + 1))).toBe("expired");
  });

  it("records a warning but never restricts with it", () => {
    const warning: SanctionFacts = {
      kind: "warning",
      startsAt: START,
      endsAt: null,
      reversedAt: null,
    };
    expect(sanctionState(warning, START)).toBe("recorded");
    expect(sanctionState(warning, at(400 * DAY_MS))).toBe("recorded");
  });

  it("keeps a permanent sanction in effect forever", () => {
    const permanent = restriction({ kind: "suspension", endsAt: null });
    expect(sanctionState(permanent, at(10_000 * DAY_MS))).toBe("in_effect");
  });

  it("lets a reversal win over every other state, immediately", () => {
    const reversedAt = at(HOUR_MS);
    expect(sanctionState(restriction({ reversedAt }), at(HOUR_MS))).toBe("reversed");
    expect(sanctionState(restriction({ reversedAt }), at(5 * DAY_MS))).toBe("reversed");
    expect(
      sanctionState(
        { kind: "warning", startsAt: START, endsAt: null, reversedAt },
        at(2 * HOUR_MS),
      ),
    ).toBe("reversed");
    expect(
      sanctionState(restriction({ kind: "suspension", endsAt: null, reversedAt }), at(HOUR_MS)),
    ).toBe("reversed");
  });
});

describe("sanctionEndsAt", () => {
  it("adds each preset's duration to the start", () => {
    const expected: Record<string, number> = {
      "24h": DAY_MS,
      "7d": 7 * DAY_MS,
      "30d": 30 * DAY_MS,
      "90d": 90 * DAY_MS,
      "1y": 365 * DAY_MS,
    };
    for (const kind of ["social_restriction", "suspension"] as const) {
      for (const [duration, ms] of Object.entries(expected)) {
        expect(
          sanctionEndsAt(kind, START, duration as keyof typeof SANCTION_DURATIONS)?.getTime(),
          `${kind} ${duration}`,
        ).toBe(START.getTime() + ms);
      }
      expect(sanctionEndsAt(kind, START, "permanent")).toBeNull();
    }
  });

  it("gives a warning no end, and refuses a restriction without a duration", () => {
    expect(sanctionEndsAt("warning", START, null)).toBeNull();
    expect(() => sanctionEndsAt("social_restriction", START, null)).toThrow(/needs a duration/);
    expect(() => sanctionEndsAt("suspension", START, null)).toThrow(/needs a duration/);
  });
});

describe("hasSanctionInEffect", () => {
  it("looks only at the requested kind and only at sanctions in effect", () => {
    const sanctions: SanctionFacts[] = [
      restriction({ endsAt: at(HOUR_MS) }),
      restriction({ kind: "suspension", reversedAt: at(1) }),
      { kind: "warning", startsAt: START, endsAt: null, reversedAt: null },
    ];
    expect(hasSanctionInEffect(sanctions, "social_restriction", at(HOUR_MS - 1))).toBe(true);
    // Exactly at its end the restriction no longer applies.
    expect(hasSanctionInEffect(sanctions, "social_restriction", at(HOUR_MS))).toBe(false);
    // A reversed suspension and a warning never count.
    expect(hasSanctionInEffect(sanctions, "suspension", at(2))).toBe(false);
    expect(hasSanctionInEffect([], "suspension", START)).toBe(false);
  });

  it("is true when any one sanction of the kind is in effect", () => {
    const sanctions = [
      restriction({ endsAt: at(HOUR_MS) }),
      restriction({ endsAt: at(3 * HOUR_MS) }),
    ];
    expect(hasSanctionInEffect(sanctions, "social_restriction", at(2 * HOUR_MS))).toBe(true);
  });
});

describe("isSanctionAppealable", () => {
  it("allows an appeal while a sanction stands, and never after it ends or is reversed", () => {
    expect(isSanctionAppealable(restriction(), at(1))).toBe(true);
    expect(isSanctionAppealable(restriction(), at(DAY_MS))).toBe(false);
    expect(isSanctionAppealable(restriction({ reversedAt: at(1) }), at(2))).toBe(false);
    const warning: SanctionFacts = {
      kind: "warning",
      startsAt: START,
      endsAt: null,
      reversedAt: null,
    };
    expect(isSanctionAppealable(warning, at(365 * DAY_MS))).toBe(true);
    expect(isSanctionAppealable({ ...warning, reversedAt: at(1) }, at(2))).toBe(false);
  });
});

describe("isSanctionNoticeCurrent", () => {
  it("surfaces a sanction in effect until it ends", () => {
    expect(isSanctionNoticeCurrent(restriction(), at(DAY_MS - 1))).toBe(true);
    expect(isSanctionNoticeCurrent(restriction(), at(DAY_MS))).toBe(false);
    expect(isSanctionNoticeCurrent(restriction({ reversedAt: at(1) }), at(2))).toBe(false);
  });

  it("surfaces a warning only inside the notice window", () => {
    const warning: SanctionFacts = {
      kind: "warning",
      startsAt: START,
      endsAt: null,
      reversedAt: null,
    };
    expect(WARNING_NOTICE_WINDOW_MS).toBe(30 * DAY_MS);
    expect(isSanctionNoticeCurrent(warning, START)).toBe(true);
    expect(isSanctionNoticeCurrent(warning, at(WARNING_NOTICE_WINDOW_MS - 1))).toBe(true);
    expect(isSanctionNoticeCurrent(warning, at(WARNING_NOTICE_WINDOW_MS))).toBe(false);
    expect(isSanctionNoticeCurrent({ ...warning, reversedAt: at(1) }, at(2))).toBe(false);
  });
});

describe("case status and reference", () => {
  it("treats Open and Reviewed as the active statuses", () => {
    expect([...ACTIVE_CASE_STATUSES]).toEqual(["open", "reviewed"]);
    expect(MODERATION_CASE_STATUSES.filter(isActiveCaseStatus)).toEqual(["open", "reviewed"]);
    expect(isActiveCaseStatus("actioned")).toBe(false);
    expect(isActiveCaseStatus("dismissed")).toBe(false);
  });

  it("pads the player-facing reference to five digits", () => {
    expect(moderationCaseReference(1)).toBe("MOD-00001");
    expect(moderationCaseReference(42)).toBe("MOD-00042");
    expect(moderationCaseReference(12345)).toBe("MOD-12345");
    expect(moderationCaseReference(123456)).toBe("MOD-123456");
  });
});

describe("normalizeModerationText", () => {
  it("trims, drops non-text controls, and keeps the text otherwise as typed", () => {
    expect(normalizeModerationText("  a note \u0000 \r\nnext ", 100)).toEqual({
      ok: true,
      text: "a note  \nnext",
    });
  });

  it("refuses blank text and overlong text, never cutting it", () => {
    expect(normalizeModerationText("   \n\t ", 10)).toEqual({ ok: false, reason: "empty" });
    expect(normalizeModerationText("abcdefghijk", 10)).toEqual({ ok: false, reason: "too_long" });
    expect(normalizeModerationText("abcdefghij", 10)).toEqual({ ok: true, text: "abcdefghij" });
  });

  it("counts code points, not UTF-16 units", () => {
    expect(normalizeModerationText("\u{1F600}".repeat(10), 10).ok).toBe(true);
    expect(normalizeModerationText("\u{1F600}".repeat(11), 10)).toEqual({
      ok: false,
      reason: "too_long",
    });
  });
});

describe("labels", () => {
  it("labels every case status, rule category, sanction kind, duration, outcome, and access kind", () => {
    for (const status of MODERATION_CASE_STATUSES) {
      expect(MODERATION_CASE_STATUS_LABEL[status], status).toBeTruthy();
    }
    for (const rule of MODERATION_RULE_CATEGORIES) {
      expect(MODERATION_RULE_LABEL[rule], rule).toBeTruthy();
    }
    for (const kind of SANCTION_KINDS) {
      expect(SANCTION_KIND_LABEL[kind], kind).toBeTruthy();
      expect(SANCTION_ACCESS_AFFECTED[kind], kind).toBeTruthy();
    }
    for (const duration of SANCTION_DURATION_KEYS) {
      expect(SANCTION_DURATION_LABEL[duration], duration).toBeTruthy();
    }
    for (const outcome of APPEAL_OUTCOMES) {
      expect(APPEAL_OUTCOME_LABEL[outcome], outcome).toBeTruthy();
    }
    for (const kind of PRIVILEGED_ACCESS_KINDS) {
      expect(PRIVILEGED_ACCESS_LABEL[kind], kind).toBeTruthy();
    }
  });

  it("has no unlabelled extra keys and one label per key", () => {
    expect(Object.keys(MODERATION_CASE_STATUS_LABEL).sort()).toEqual(
      [...MODERATION_CASE_STATUSES].sort(),
    );
    expect(Object.keys(MODERATION_RULE_LABEL).sort()).toEqual(
      [...MODERATION_RULE_CATEGORIES].sort(),
    );
    expect(Object.keys(SANCTION_KIND_LABEL).sort()).toEqual([...SANCTION_KINDS].sort());
    expect(Object.keys(SANCTION_DURATION_LABEL).sort()).toEqual([...SANCTION_DURATION_KEYS].sort());
    expect(Object.keys(PRIVILEGED_ACCESS_LABEL).sort()).toEqual(
      [...PRIVILEGED_ACCESS_KINDS].sort(),
    );
  });

  it("describes a duration to the player, and a warning as untimed", () => {
    expect(sanctionDurationLabel("suspension", "7d")).toBe("7 days");
    expect(sanctionDurationLabel("social_restriction", "permanent")).toBe("Permanent");
    expect(sanctionDurationLabel("warning", null)).toMatch(/restricts nothing/);
    expect(sanctionDurationLabel("social_restriction", null)).toMatch(/restricts nothing/);
  });
});

describe("a suspension in the gameplay-access rule", () => {
  const open = { emailVerified: true, earlyAccessGranted: true, publicGameplayOpen: true };

  it("outranks Early Access and public gameplay", () => {
    expect(decideGameplayAccess({ ...open, suspended: false })).toEqual({
      allowed: true,
      via: "public",
    });
    expect(decideGameplayAccess({ ...open, suspended: true })).toEqual({
      allowed: false,
      reason: "suspended",
    });
    expect(decideGameplayAccess({ ...open, publicGameplayOpen: false, suspended: true })).toEqual({
      allowed: false,
      reason: "suspended",
    });
    expect(
      decideGameplayAccess({
        ...open,
        earlyAccessGranted: false,
        publicGameplayOpen: false,
        suspended: true,
      }),
    ).toEqual({ allowed: false, reason: "suspended" });
  });

  it("still reports an unverified email first", () => {
    expect(decideGameplayAccess({ ...open, emailVerified: false, suspended: true })).toEqual({
      allowed: false,
      reason: "email_unverified",
    });
  });
});

// ---------------------------------------------------------------------------
// Surface guards
// ---------------------------------------------------------------------------

const REQUIRED_ENV = {
  NODE_ENV: "test",
  DATABASE_URL: "postgres://test:test@localhost:5432/test",
  BETTER_AUTH_SECRET: "test-secret-1234567890123456",
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("moderation production command surface (requireAdmin-only)", () => {
  const SOURCE = "server/moderation-commands.ts";

  it("exports no internal *As seam name", async () => {
    for (const [name, value] of Object.entries(REQUIRED_ENV)) vi.stubEnv(name, value);
    vi.resetModules();
    const mod = (await import("@/server/moderation-commands")) as Record<string, unknown>;
    const exportedNames = Object.keys(mod).filter((name) => name !== "default");
    expect(exportedNames.length).toBeGreaterThan(0);
    expect(exportedNames.filter((name) => /As$/.test(name))).toEqual([]);
    expect(exportedNames.filter((name) => /AsAdmin|ForAdmin/.test(name))).toEqual([]);
  });

  it("calls requireAdmin( in the body of every exported function", () => {
    const source = readFileSync(SOURCE, "utf8");
    const exported = [
      ...source.matchAll(/^export (?:async )?function (\w+)\s*(?:<[^>]*>)?\(/gm),
    ].map((match) => ({ name: match[1]!, index: match.index! }));
    expect(exported.length).toBeGreaterThanOrEqual(12);
    for (const [position, fn] of exported.entries()) {
      // A function body runs to the next top-level declaration.
      const rest = source.slice(fn.index);
      const end = rest.slice(1).search(/^(?:export )?(?:async )?(?:function|type|const|class) /m);
      const body = end === -1 ? rest : rest.slice(0, end + 1);
      expect(body, `${fn.name} must authenticate with requireAdmin(headers)`).toContain(
        "requireAdmin(headers)",
      );
      // It authenticates before it touches the database.
      expect(body.indexOf("requireAdmin(headers)"), fn.name).toBeLessThan(
        body.search(/db\.transaction|db\./),
      );
      expect(position).toBeGreaterThanOrEqual(0);
    }
  });

  it("never passes a browser-nominated admin id: no exported function takes one", () => {
    const source = readFileSync(SOURCE, "utf8");
    expect(source).not.toMatch(/export (?:async )?function \w+\(\s*adminUserId/);
    expect(source).not.toMatch(/adminUserId:\s*string/);
  });
});

/**
 * The append-only records have no application update or delete path
 * (issue #248): privileged access, operator audit, and case notes are written
 * once and never changed. Only the test fixtures' FK-safe teardown deletes.
 */
describe("append-only moderation records have no update or delete path", () => {
  function sourceFilesUnder(root: string, out: string[] = []): string[] {
    const abs = join(process.cwd(), root);
    if (!statSync(abs, { throwIfNoEntry: false })) return out;
    for (const entry of readdirSync(abs)) {
      const full = join(abs, entry);
      const rel = join(root, entry);
      if (statSync(full).isDirectory()) sourceFilesUnder(rel, out);
      else if (rel.endsWith(".ts") || rel.endsWith(".tsx")) out.push(rel);
    }
    return out;
  }

  const FORBIDDEN = ["privilegedAccessLogs", "operatorAuditLogs", "moderationCaseNotes"].flatMap(
    (table) => [`.update(${table}`, `.delete(${table}`],
  );

  it("has no .update( or .delete( on the append-only tables under server, app, features", () => {
    const violations: string[] = [];
    for (const root of ["server", "app", "features"]) {
      for (const rel of sourceFilesUnder(root)) {
        const source = readFileSync(rel, "utf8");
        for (const pattern of FORBIDDEN) {
          if (source.includes(pattern)) violations.push(`${rel}: ${pattern}`);
        }
      }
    }
    expect(violations).toEqual([]);
  });

  it("scans real files (the guard is not vacuous)", () => {
    expect(sourceFilesUnder("server").length).toBeGreaterThan(20);
    const seams = readFileSync("server/moderation-seams.ts", "utf8");
    expect(seams).toContain("moderationCaseNotes");
  });
});
