import type { SiteStashState } from "@/server/play";

/**
 * The one-line state of a site stash, for its collapsed disclosure bar (#284).
 *
 * A stash is secondary to the site's own activity, so at rest it is a compact
 * bar that says only which stage it is in and the progress that matters:
 * material and weld counts while it is being built, then the installed
 * container and its slot use. Everything else (full material meters, the
 * Welding and carry summaries, management controls) lives in the expanded
 * detail. Derived from the authoritative projection; nothing here is authority.
 */
export type SiteStashSummary = {
  stage: "build" | "install" | "stash";
  /** The bar's heading. */
  label: string;
  /** Compact progress, e.g. "Refined Ferrite 2 / 6 · Slag 0 / 3 · 0 / 6 welds". */
  detail: string;
};

export function summarizeSiteStash(stash: SiteStashState): SiteStashSummary {
  if (!stash.mountBuilt) {
    const { repair } = stash;
    const welds = `${repair.weldingProgress} / ${repair.weldingIncrements} welds`;
    // Once every material is in, the counts are noise: the weld progress is the
    // only thing left to report.
    if (repair.materialComplete) {
      return { stage: "build", label: "Build Stash Mount", detail: `Materials in · ${welds}` };
    }
    const materials = repair.materials
      .map((material) => `${material.name} ${material.contributed} / ${material.required}`)
      .join(" · ");
    return { stage: "build", label: "Build Stash Mount", detail: `${materials} · ${welds}` };
  }
  if (!stash.container) {
    return { stage: "install", label: "Site Stash", detail: "Mount built · Install a container" };
  }
  return {
    stage: "stash",
    label: "Site Stash",
    detail: `${stash.container.name} · ${stash.slotsUsed} / ${stash.capacitySlots} slots`,
  };
}
