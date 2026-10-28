import { describe, expect, it } from "vitest";
import { classifyCountry } from "@/features/analytics/analytics-region";

/** Pure country-to-region mapping (issue #419). It grants no tracking. */

const EEA = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR",
  "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO",
]; // prettier-ignore

describe("classifyCountry", () => {
  it("maps the United States to us", () => {
    expect(classifyCountry("US")).toBe("us");
  });

  it("maps Great Britain to uk", () => {
    expect(classifyCountry("GB")).toBe("uk");
  });

  it("maps all 27 EU member states plus Iceland, Liechtenstein and Norway to eea", () => {
    expect(new Set(EEA).size).toBe(30);
    for (const code of EEA) expect(classifyCountry(code), code).toBe("eea");
  });

  it.each([
    ["Switzerland (not EEA)", "CH"],
    ["Canada", "CA"],
    ["Australia", "AU"],
    ["Japan", "JP"],
    ["Brazil", "BR"],
    ["Qatar (starts with Q, a real country)", "QA"],
    ["Puerto Rico (US territory)", "PR"],
    ["Guam (US territory)", "GU"],
    ["Jersey (Crown Dependency)", "JE"],
    ["Isle of Man (Crown Dependency)", "IM"],
    ["Gibraltar (UK overseas territory)", "GI"],
    ["Greenland (Danish territory)", "GL"],
    ["Réunion (French overseas)", "RE"],
    ["Russia", "RU"],
  ])("maps %s to other", (_label, code) => {
    expect(classifyCountry(code)).toBe("other");
  });

  it.each([
    ["null", null],
    ["undefined", undefined],
    ["empty", ""],
    ["lowercase", "us"],
    ["mixed case", "Us"],
    ["three letters", "USA"],
    ["one letter", "U"],
    ["padded", " US"],
    ["trailing space", "US "],
    ["digits", "12"],
    ["unknown placeholder", "ZZ"],
    ["user-assigned AA", "AA"],
    ["user-assigned XK (Kosovo, no ISO code)", "XK"],
    ["user-assigned XX", "XX"],
    ["user-assigned QM", "QM"],
    ["user-assigned QZ", "QZ"],
    ["European Union reservation", "EU"],
    ["United Nations reservation", "UN"],
    ["Asia-Pacific legacy code", "AP"],
    ["UK reservation (country is GB)", "UK"],
    ["Ascension Island (exceptional reservation)", "AC"],
    ["Clipperton Island (exceptional reservation)", "CP"],
    ["Diego Garcia (exceptional reservation)", "DG"],
    ["Ceuta and Melilla (exceptional reservation)", "EA"],
    ["Metropolitan France (retired)", "FX"],
    ["Canary Islands (exceptional reservation)", "IC"],
    ["Soviet Union (retired)", "SU"],
    ["Tristan da Cunha (exceptional reservation)", "TA"],
    ["Eurozone (exceptional reservation)", "EZ"],
    ["Netherlands Antilles (retired)", "AN"],
    ["Serbia and Montenegro (retired)", "CS"],
    ["Yugoslavia (retired)", "YU"],
    ["East Timor (retired)", "TP"],
    ["Zaire (retired)", "ZR"],
    ["Burma (retired)", "BU"],
    ["unassigned AB", "AB"],
    ["unassigned QQ", "QQ"],
    ["unassigned JJ", "JJ"],
    ["unassigned XQ", "XQ"],
    ["unassigned WW", "WW"],
    ["unassigned ZY", "ZY"],
  ])("maps %s to unknown", (_label, code) => {
    expect(classifyCountry(code)).toBe("unknown");
  });

  it("recognises exactly the 249 ISO 3166-1 assigned codes among all 676 letter pairs", () => {
    const letters = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
    const recognised: string[] = [];
    for (const a of letters) {
      for (const b of letters) {
        if (classifyCountry(`${a}${b}`) !== "unknown") recognised.push(`${a}${b}`);
      }
    }
    expect(recognised).toHaveLength(249);
    // Spot checks at the alphabet's edges and for the codes most often missed.
    for (const code of ["AD", "ZW", "AX", "BQ", "CW", "SS", "SX"]) {
      expect(recognised, code).toContain(code);
    }
    expect(recognised).not.toContain("XK");
    expect(recognised).not.toContain("ZZ");
  });

  it("never returns a region for a non-assigned code, whatever its shape", () => {
    for (const code of ["EZ", "ac", "A", "AAA", "A1", "1A", "A ", "\u0410D", "A\u0000"]) {
      expect(classifyCountry(code), JSON.stringify(code)).toBe("unknown");
    }
  });

  it("does not coerce non-string input", () => {
    expect(classifyCountry(42 as unknown as string)).toBe("unknown");
    expect(classifyCountry({} as unknown as string)).toBe("unknown");
  });
});
