import { z } from "zod";
import { ContentId } from "./ids";

/**
 * Portrait catalog validation contract (issue #70).
 *
 * The portrait catalog is content: stable IDs, player-facing names, launch
 * categories, and committed asset paths are data-driven definitions validated
 * here, never UI literals. Launch categories are authoritative metadata only —
 * they are not encoded in filenames or directory names, so a later approved
 * availability change never requires moving an asset.
 */
export const PORTRAIT_LAUNCH_CATEGORIES = [
  "player-starter",
  "player-unlockable",
  "npc-only",
  "reserved",
] as const;

export type PortraitLaunchCategory = (typeof PORTRAIT_LAUNCH_CATEGORIES)[number];

export const PortraitLaunchCategorySchema = z.enum(PORTRAIT_LAUNCH_CATEGORIES);

export const PortraitDefinitionSchema = z
  .object({
    /** Stable content ID (see game/schemas/ids). */
    id: ContentId,
    /** Short player-facing name. */
    displayName: z.string().min(1),
    /** Descriptive character concept; never ethnicity-based. */
    concept: z.string().min(1),
    /** Exact launch availability category. */
    category: PortraitLaunchCategorySchema,
    /** Repository-relative path of the canonical high-resolution master (outside public/). */
    masterPath: z.string().min(1),
    /** Client URL path of the committed optimized production derivative under public/. */
    derivativePath: z.string().min(1),
    /** Intrinsic derivative dimensions for stable layout (issue #65). */
    derivativeWidth: z.number().int().positive(),
    derivativeHeight: z.number().int().positive(),
    /** Concise accessible description for image alt text. */
    accessibleDescription: z.string().min(1),
  })
  .strict();

export type PortraitDefinition = z.infer<typeof PortraitDefinitionSchema>;
