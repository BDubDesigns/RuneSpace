import { describe, expect, it } from "vitest";
import { summarizeSiteStash } from "@/features/site-stash/site-stash-summary";
import type { SiteStashState } from "@/server/play";

/** A projection with only the fields the summary reads; the rest is irrelevant. */
function stash(
  overrides: Partial<Omit<SiteStashState, "repair">> & {
    repair?: Partial<SiteStashState["repair"]>;
  },
) {
  const { repair, ...rest } = overrides;
  return {
    locationId: "the_jag",
    mountBuilt: false,
    stacks: [],
    uniqueItems: [],
    slotsUsed: 0,
    capacitySlots: 0,
    carriedContainers: [],
    swappableContainerInstanceIds: [],
    repair: {
      targetId: "site_stash_the_jag",
      materials: [
        { itemId: "refined_ferrite", name: "Refined Ferrite", required: 6, contributed: 2 },
        { itemId: "slag", name: "Slag", required: 3, contributed: 0 },
      ],
      weldingProgress: 0,
      weldingIncrements: 6,
      materialComplete: false,
      complete: false,
      repairAvailable: true,
      canContribute: false,
      ...repair,
    },
    ...rest,
  } as unknown as SiteStashState;
}

describe("site stash disclosure summary", () => {
  it("reports each outstanding material and the welds while materials are short", () => {
    expect(summarizeSiteStash(stash({}))).toEqual({
      stage: "build",
      label: "Build Stash Mount",
      detail: "Refined Ferrite 2 / 6 · Slag 0 / 3 · 0 / 6 welds",
    });
  });

  it("drops the material counts once every material is installed", () => {
    expect(
      summarizeSiteStash(stash({ repair: { materialComplete: true, weldingProgress: 4 } })),
    ).toEqual({
      stage: "build",
      label: "Build Stash Mount",
      detail: "Materials in · 4 / 6 welds",
    });
  });

  it("asks for a container once the mount is built", () => {
    expect(summarizeSiteStash(stash({ mountBuilt: true }))).toEqual({
      stage: "install",
      label: "Site Stash",
      detail: "Mount built · Install a container",
    });
  });

  it("reports the installed container and its slot use", () => {
    const summary = summarizeSiteStash(
      stash({
        mountBuilt: true,
        slotsUsed: 1,
        capacitySlots: 3,
        container: {
          itemInstanceId: "x",
          itemId: "scrap_box",
          name: "Scrap Box",
          slotCapacity: 3,
          massGrams: 5000,
        },
      }),
    );
    expect(summary).toEqual({
      stage: "stash",
      label: "Site Stash",
      detail: "Scrap Box · 1 / 3 slots",
    });
  });
});
