import { describe, expect, it } from "vitest";
import { intentClassNames } from "@/components/ui/variants";

describe("visual intent variants", () => {
  it("maps every semantic intent to a distinct token-backed style", () => {
    const variants = Object.entries(intentClassNames);

    expect(variants).toHaveLength(6);
    expect(new Set(variants.map(([, className]) => className)).size).toBe(variants.length);
    for (const [, className] of variants) expect(className).toContain("var(--rs-");
  });
});
