import { describe, expect, it } from "vitest";
import {
  getWikiArticle,
  getWikiArticleGroups,
  getWikiArticles,
} from "@/features/public-site/public-wiki";
import {
  MINING_FILM_BUFF,
  THEATRE_COPY,
  THEATRE_FILMS,
  THEATRE_PRE_ROLL_SLOTS,
  THEATRE_SCREENS,
  THEATRE_TICKET_TIERS,
  WELDING_FILM_BUFF,
} from "@/game/content/theatre";
import { applyFilmXpBonus, topUpCharges } from "@/game/domain/theatre";

/**
 * The Holo Drive-In Wiki guide (#491) states real numbers and labels. These tests read them from the
 * theatre content and rules, so the guide cannot quietly drift from what ships, and they hold the
 * boundary the Wiki and Updates must keep: nothing about an unshipped planet and nothing internal about
 * Tamsyn.
 */

function textOf(slug: string): string {
  const article = getWikiArticle(slug);
  if (!article) throw new Error(`No Wiki article "${slug}"`);
  const flatten = (entry: string | readonly (string | { text: string })[]) =>
    typeof entry === "string"
      ? entry
      : entry.map((s) => (typeof s === "string" ? s : s.text)).join("");
  return [
    article.title,
    article.summary,
    ...article.sections.flatMap((section) => [
      section.heading ?? "",
      ...(section.paragraphs ?? []).map(flatten),
      ...(section.list ?? []).map(flatten),
    ]),
  ].join("\n");
}

describe("Holo Drive-In Wiki guide (#491)", () => {
  const guide = textOf("holo-drive-in");

  it("is a places-and-travel guide that the index lists", () => {
    const article = getWikiArticle("holo-drive-in");
    expect(article?.title).toBe("Holo Drive-In");
    const places = getWikiArticleGroups().find((group) => group.id === "places-and-travel");
    expect(places?.articles.map((a) => a.slug)).toContain("holo-drive-in");
  });

  it("states both tickets exactly as the theatre sells them", () => {
    expect(THEATRE_TICKET_TIERS.map((t) => [t.name, t.credits, t.capacity])).toEqual([
      ["Film Ticket", 20, 20],
      ["Ticket + Concessions", 50, 50],
    ]);
    for (const tier of THEATRE_TICKET_TIERS) {
      expect(guide).toContain(
        `${tier.name}: ${tier.credits} Credits for ${tier.capacity} bonus attempts`,
      );
    }
  });

  it("states the two bonuses at their real size and rounding", () => {
    expect(MINING_FILM_BUFF.xpBonusBps).toBe(500);
    expect(WELDING_FILM_BUFF.xpBonusBps).toBe(1_000);
    expect(guide).toContain("5% more Mining XP");
    expect(guide).toContain("10% more Welding XP");
    // The worked examples in the guide are what the rule produces.
    expect(applyFilmXpBonus(50, WELDING_FILM_BUFF.xpBonusBps)).toBe(55);
    expect(applyFilmXpBonus(10, WELDING_FILM_BUFF.xpBonusBps)).toBe(11);
    expect(guide).toContain("a 50 XP section pays 55, and a 10 XP practice section pays 11");
  });

  it("states the top-up example the rules give", () => {
    const [film, concessions] = THEATRE_TICKET_TIERS;
    expect(topUpCharges(5, film.capacity)).toMatchObject({ remainingAfter: 20, added: 15 });
    expect(topUpCharges(5, concessions.capacity)).toMatchObject({ remainingAfter: 50, added: 45 });
    expect(guide).toContain("brings you to 20 (it adds 15)");
    expect(guide).toContain("brings you to 50 (it adds 45)");
  });

  it("describes the hourly alternation of the real programme and the films' own skills", () => {
    const screen = THEATRE_SCREENS[0]!;
    expect(screen.windowMs).toBe(60 * 60 * 1000);
    expect(screen.rotation).toHaveLength(2);
    expect(THEATRE_FILMS.map((f) => [f.title, f.skillId])).toEqual([
      ["That Mines Mine!", "mining"],
      ["Rare or Weld Done?", "welding"],
    ]);
    // Even UTC hours show the first film in the rotation, odd hours the second.
    expect(guide).toContain("That Mines Mine! plays during the even UTC hours");
    expect(guide).toContain("Rare or Weld Done? during the odd ones");
    expect(guide).toContain("Each showing lasts one hour");
  });

  it("names the screen's labels and the three commercials as they ship", () => {
    expect(THEATRE_COPY.watchFilm).toBe("Watch Film");
    expect(THEATRE_COPY.replayLastFilm).toBe("Replay Last Film");
    expect(guide).toContain("Watch Film");
    expect(guide).toContain("Replay Last Film");
    expect(THEATRE_PRE_ROLL_SLOTS.map((s) => s.title)).toEqual([
      "DeWHAT?",
      "Visit Skatboll!",
      "FedHex",
    ]);
    expect(guide).toContain("(DeWHAT?, Visit Skatboll! and FedHex)");
    expect(guide).toContain("three silent 15-second spots");
  });

  it("says the bonus comes from the ticket, not from watching", () => {
    expect(guide).toContain("A ticket's bonus starts the moment you buy it, not when you watch");
  });

  it("covers Tamsyn with shipped, player-facing facts only", () => {
    expect(guide).toContain("Tamsyn Suzara owns and runs the Holo Drive-In");
    expect(guide).toContain("What's showing?");
    expect(guide).toContain("Tell me about the projector");
    expect(guide).toContain("Why keep this place open?");
  });

  it("keeps unshipped lore and Tamsyn's private history out of every public article", () => {
    for (const article of getWikiArticles()) {
      const text = textOf(article.slug);
      expect(text, article.slug).not.toMatch(/Tortuga/i);
      if (article.slug === "holo-drive-in") {
        expect(text).not.toMatch(/Tansy|projector upgrade|restor|SSA|grand re-?opening/i);
      }
    }
  });

  it("is linked from the places, work and progression articles that mention its bonuses", () => {
    for (const slug of [
      "getting-started",
      "travel-and-scavenging",
      "holo-hollow",
      "mining-and-refining",
      "credits-and-trading",
      "skills-and-progression",
      "cargo-hold-and-welding",
      "practice-welding",
      "work-orders",
    ]) {
      const links = getWikiArticle(slug)!.sections.flatMap((section) =>
        [...(section.paragraphs ?? []), ...(section.list ?? [])].flatMap((entry) =>
          typeof entry === "string"
            ? []
            : entry.flatMap((s) => (typeof s === "string" ? [] : [s.articleSlug])),
        ),
      );
      expect(links, slug).toContain("holo-drive-in");
    }
  });
});
