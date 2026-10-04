import { XP_MEDALLION_SRC, xpAccentColor } from "@/components/ui/XpAmount";
import { VisualTile } from "./VisualTile";

/**
 * The skill-XP reward tile (#304): the shared XP medallion in the common
 * `VisualTile`, outlined in the skill's canonical accent (a skill without one gets the neutral structural border), with the skill's name
 * on the plate and the earned amount in the corner. The medallion is the same
 * neutral image for every skill; skill identity is the name and accent. Pure
 * presentation of an amount the caller already has: XP is never an item.
 */
export function SkillXpTile({
  amount,
  className,
  skillId,
  skillName,
}: {
  amount: number;
  className?: string;
  skillId: string;
  skillName: string;
}) {
  return (
    <VisualTile
      accentColor={xpAccentColor(skillId) ?? "var(--rs-border-structural)"}
      accessibleLabel={`${amount} ${skillName} XP earned`}
      artworkSrc={XP_MEDALLION_SRC}
      badge={`+${amount}`}
      className={className}
      fallbackText="XP"
      name={skillName}
    />
  );
}
