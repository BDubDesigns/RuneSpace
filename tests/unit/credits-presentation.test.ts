import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CreditsAmount, CreditsIcon } from "@/components/ui/CreditsAmount";
import { creditsReceiptBeat } from "@/features/dialogue/credits-receipt";
import { DialoguePlayer } from "@/features/dialogue/DialoguePlayer";
import { DialogueScene } from "@/features/dialogue/DialogueScene";
import { getConversationBackground } from "@/game/content/conversation-backgrounds";
import { CONVERSATION_BACKGROUND_IDS, DIALOGUE_IDS, MISSION_IDS } from "@/game/config/foundations";
import { DIALOGUE_SEQUENCES, getDialogue, type DialogueBeat } from "@/game/content/dialogue";
import { KEEP_THE_CHANGE_BUDGET_CREDITS, MISSIONS } from "@/game/content/missions";
import { resolveMissionSuccessView } from "@/game/domain/conversation";

const text = (markup: string) =>
  markup
    .replace(/<[^>]*>/g, "")
    .replace(/\s+/g, " ")
    .trim();

describe("Credits artwork (issue #290)", () => {
  it("commits the owner-supplied artwork unchanged", () => {
    const sha = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
    expect(sha("public/currency/credits-icon.svg")).toBe(
      "4971e5053891e20a08a3519fd16d29f5fe4b87830789e41c7edda1605259c020",
    );
    expect(sha("assets/currency/credits-chip-master.png")).toBe(
      "908c38c0bed893f62fc54dd345668bf492312b514df6934eb4d8a5fb4da8e8df",
    );
  });

  it("ships a small, truly transparent raster derivative", () => {
    const file = "public/currency/credits-chip.webp";
    const bytes = readFileSync(file);
    expect(bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
    expect(bytes.subarray(8, 12).toString("ascii")).toBe("WEBP");
    // An extended header whose alpha flag is set: the chip really has an alpha channel.
    expect(bytes.subarray(12, 16).toString("ascii")).toBe("VP8X");
    expect(bytes[20]! & 0x10).toBe(0x10);
    expect(statSync(file).size).toBeLessThan(100 * 1024);
  });

  it("sizes the inline icon from the text, never a fixed pixel size", () => {
    const css = readFileSync("app/globals.css", "utf8");
    const rule = /\.rs-credits-icon\s*\{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(rule).toMatch(/height:\s*1em/);
    // The owner SVG's 96x72 viewBox is 4:3.
    expect(rule).toMatch(/width:\s*1\.3333em/);
    expect(rule).not.toMatch(/\d\s*px/);
    expect(readFileSync("public/currency/credits-icon.svg", "utf8")).toContain(
      'viewBox="0 0 96 72"',
    );
  });
});

describe("CreditsAmount", () => {
  it("renders a hidden decorative icon beside the visible number and word", () => {
    const markup = renderToStaticMarkup(React.createElement(CreditsAmount, { amount: 42 }));
    expect(markup).toContain('src="/currency/credits-icon.svg"');
    expect(markup).toContain('alt=""');
    expect(markup).toContain('aria-hidden="true"');
    // The icon contributes no text, so the amount reads the same with images off.
    expect(text(markup)).toBe("42 Credits");
  });

  it("supports the Cr unit, a bare number, a prefix and pre-formatted text", () => {
    const render = (props: Partial<React.ComponentProps<typeof CreditsAmount>>) =>
      text(renderToStaticMarkup(React.createElement(CreditsAmount, { amount: 50, ...props })));
    expect(render({ unit: "Cr" })).toBe("50 Cr");
    expect(render({ unit: null })).toBe("50");
    expect(render({ prefix: "+" })).toBe("+50 Credits");
    expect(
      text(
        renderToStaticMarkup(React.createElement(CreditsAmount, { amount: 1200 }, "1,200 Credits")),
      ),
    ).toBe("1,200 Credits");
  });

  it("keeps data hooks on the wrapper and adds no accessible name", () => {
    const markup = renderToStaticMarkup(
      React.createElement(CreditsAmount, { amount: 7, "data-offer-credits": "" } as never),
    );
    expect(markup).toContain("data-offer-credits");
    expect(markup).not.toContain("aria-label");
    expect(markup).not.toContain("<title");
  });

  it("exposes the icon alone for surfaces whose hook wraps only the number", () => {
    const markup = renderToStaticMarkup(React.createElement(CreditsIcon));
    expect(text(markup)).toBe("");
    expect(markup).toContain("data-credits-icon");
  });
});

describe("Credits reward tile", () => {
  const background = CONVERSATION_BACKGROUND_IDS.crashSiteExterior;

  it("presents the approved chip, a Credits nameplate and the actual amount", () => {
    const markup = renderToStaticMarkup(
      React.createElement(DialogueScene, { beat: creditsReceiptBeat(36, background) }),
    );
    expect(markup).toContain('data-dialogue-subject="credits_receipt"');
    expect(markup).toContain("data-dialogue-credits-tile");
    expect(markup).toContain('data-credits-amount="36"');
    expect(markup).toContain(encodeURIComponent("/currency/credits-chip.webp"));
    expect(markup).toContain('aria-label="36 Credits received"');
    expect(markup).toContain(">+36<");
    expect(markup).toContain(">Credits<");
    // Never an inventory item.
    expect(markup).not.toContain("data-dialogue-item-artwork");
  });

  it("cannot be authored: no authored beat or sequence is a Credits receipt", () => {
    // @ts-expect-error a Credits receipt is not an authorable DialogueBeat kind.
    const authorableKind: DialogueBeat["kind"] = "credits_receipt";
    expect(authorableKind).toBe("credits_receipt");
    const kinds = new Set(
      DIALOGUE_SEQUENCES.flatMap((sequence) => sequence.beats.map((beat) => beat.kind)),
    );
    expect([...kinds].sort()).toEqual(["item", "npc", "skill_xp"]);
  });

  it("leads an authored sequence without replacing any of it", () => {
    const sequence = getDialogue(DIALOGUE_IDS.wadeTenThousandHoursCompletion)!;
    const withReceipt = renderToStaticMarkup(
      React.createElement(DialoguePlayer, {
        sequence,
        receipt: { amount: 50, placement: "leads" },
        onBack: () => undefined,
        onFinish: () => undefined,
      }),
    );
    expect(withReceipt).toContain("data-dialogue-credits-tile");
    expect(withReceipt).toContain('data-credits-amount="50"');
    // It is the first of the original beats plus one, never fewer.
    const without = renderToStaticMarkup(
      React.createElement(DialoguePlayer, {
        sequence,
        onBack: () => undefined,
        onFinish: () => undefined,
      }),
    );
    expect(without).not.toContain("data-dialogue-credits-tile");
    expect(without).toContain('data-dialogue-subject="npc"');
  });

  it("stands alone as a single Finish scene when nothing is authored after the payment", () => {
    const sequence = getDialogue(DIALOGUE_IDS.wadeKeepTheChangeOffer)!;
    const markup = renderToStaticMarkup(
      React.createElement(DialoguePlayer, {
        sequence,
        receipt: { amount: KEEP_THE_CHANGE_BUDGET_CREDITS, placement: "stands_alone" },
        onBack: () => undefined,
        onFinish: () => undefined,
      }),
    );
    expect(markup).toContain(`data-credits-amount="${KEEP_THE_CHANGE_BUDGET_CREDITS}"`);
    expect(markup).toContain("Finish");
    expect(markup).not.toContain("data-dialogue-action");
    // Shown where Wade made the offer, and none of the offer is replayed.
    const lastBackground = sequence.beats[sequence.beats.length - 1]!.backgroundId;
    expect(markup).toContain(getConversationBackground(lastBackground)!.alt);
    expect(markup).not.toContain('data-dialogue-subject="npc"');
  });
});

describe("Mission Credits receipts resolve to a reward tile only for a confirmed payment", () => {
  const keepTheChange = MISSIONS.find((mission) => mission.id === MISSION_IDS.keepTheChange)!;
  const tenThousandHours = MISSIONS.find((mission) => mission.id === MISSION_IDS.tenThousandHours)!;
  const cuttingCosts = MISSIONS.find((mission) => mission.id === MISSION_IDS.cuttingCosts)!;

  it("audits every shipped Mission that pays Credits on acceptance or completion", () => {
    const acceptance = MISSIONS.filter((mission) =>
      mission.offers.some((offer) => offer.acceptEffect?.kind === "credits"),
    ).map((mission) => mission.id);
    const completion = MISSIONS.filter((mission) => mission.reward?.kind === "credits").map(
      (mission) => mission.id,
    );
    expect(acceptance).toEqual([MISSION_IDS.keepTheChange]);
    expect(completion).toEqual([MISSION_IDS.tenThousandHours, MISSION_IDS.cuttingCosts]);
    // Each completion that pays has an authored scene the tile can lead.
    for (const mission of [tenThousandHours, cuttingCosts]) {
      expect(mission.dialogue.completionPresentationDialogueId).toBeDefined();
    }
  });

  it("Keep the Change: a committed acceptance shows the tile for the paid amount", () => {
    const offer = keepTheChange.offers[0]!;
    const view = resolveMissionSuccessView({
      actionKind: "accept_mission",
      missionId: keepTheChange.id,
      dialogueId: offer.dialogueId,
      mission: { status: "accepted", creditsPaid: KEEP_THE_CHANGE_BUDGET_CREDITS },
    });
    expect(view).toEqual({
      kind: "dialogue",
      dialogueId: offer.dialogueId,
      creditsReceipt: { amount: KEEP_THE_CHANGE_BUDGET_CREDITS, placement: "stands_alone" },
    });
  });

  it("an accepted continuation keeps playing, with the tile in front of it", () => {
    const view = resolveMissionSuccessView({
      actionKind: "accept_mission",
      missionId: "synthetic",
      dialogueId: DIALOGUE_IDS.wadeKeepTheChangeOffer,
      acceptedContinuation: {
        dialogueId: DIALOGUE_IDS.wadeTenThousandHoursAccepted,
        action: { kind: "complete_mission", label: "Go" },
      },
      mission: { status: "accepted", creditsPaid: 25 },
    });
    expect(view).toEqual({
      kind: "dialogue",
      dialogueId: DIALOGUE_IDS.wadeTenThousandHoursAccepted,
      action: { kind: "complete_mission", label: "Go" },
      creditsReceipt: { amount: 25, placement: "leads" },
    });
  });

  it("a continuation with no payment shows no tile and is otherwise unchanged", () => {
    const offer = tenThousandHours.offers[0]!;
    const view = resolveMissionSuccessView({
      actionKind: "accept_mission",
      missionId: tenThousandHours.id,
      dialogueId: offer.dialogueId,
      acceptedContinuation: offer.acceptedContinuation!,
      mission: { status: "accepted" },
    });
    expect(view).toEqual({
      kind: "dialogue",
      dialogueId: offer.acceptedContinuation!.dialogueId,
    });
  });

  it("10,000 Hours and Cutting Costs completions lead their presentation with the paid amount", () => {
    for (const [mission, amount] of [
      [tenThousandHours, 50],
      [cuttingCosts, 500],
    ] as const) {
      const view = resolveMissionSuccessView({
        actionKind: "complete_mission",
        missionId: mission.id,
        dialogueId: mission.turnIn.dialogueId,
        mission: { status: "completed", creditsPaid: amount },
      });
      expect(view).toEqual({
        kind: "dialogue",
        dialogueId: mission.dialogue.completionPresentationDialogueId,
        creditsReceipt: { amount, placement: "leads" },
      });
      // The receipt amount is the authored reward, never a client invention.
      expect(mission.reward).toEqual({ kind: "credits", amount });
    }
  });

  it("a completion with a payment but no authored scene stands alone", () => {
    const view = resolveMissionSuccessView({
      actionKind: "complete_mission",
      missionId: "synthetic-without-presentation",
      dialogueId: DIALOGUE_IDS.wadeTenThousandHoursTurnIn,
      mission: { status: "completed", creditsPaid: 9 },
    });
    expect(view).toEqual({
      kind: "dialogue",
      dialogueId: DIALOGUE_IDS.wadeTenThousandHoursTurnIn,
      creditsReceipt: { amount: 9, placement: "stands_alone" },
    });
  });

  it("repeats, refusals, replays and unpaid successes never show a tile", () => {
    const base = {
      missionId: tenThousandHours.id,
      dialogueId: tenThousandHours.turnIn.dialogueId,
    };
    const results = [
      { actionKind: "accept_mission", mission: { status: "already_accepted" } },
      { actionKind: "accept_mission", mission: { status: "already_completed" } },
      { actionKind: "complete_mission", mission: { status: "already_completed" } },
      { actionKind: "acknowledge_conversation", mission: { status: "acknowledged" } },
      { actionKind: "acknowledge_conversation", mission: { status: "already_acknowledged" } },
      { actionKind: "accept_mission", mission: { status: "accepted" } },
      { actionKind: "accept_mission", mission: { status: "accepted", creditsPaid: 0 } },
    ] as const;
    for (const result of results) {
      const view = resolveMissionSuccessView({ ...base, ...result });
      if (view.kind === "dialogue") expect(view.creditsReceipt).toBeUndefined();
      else expect(view).toEqual({ kind: "hub" });
    }
    // A completed Mission that paid nothing (e.g. an XP reward) shows no Credits tile.
    const xpView = resolveMissionSuccessView({
      actionKind: "complete_mission",
      missionId: MISSION_IDS.cutYourTeeth,
      dialogueId: DIALOGUE_IDS.wadeTenThousandHoursTurnIn,
      mission: { status: "completed" },
    });
    expect(xpView.kind === "dialogue" ? xpView.creditsReceipt : undefined).toBeUndefined();
  });
});
