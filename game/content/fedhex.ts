import { NPC_IDS } from "@/game/config/foundations";
import { getNpc } from "@/game/content/npcs";

/**
 * FedHex (#399): RuneSpace's interplanetary parcel and postal service.
 *
 * The brand is permanent and broader than any one use. Slice J's single
 * authored message is the Legendary Echo recovery parcel; postage, delivery
 * times, player-written letters and multi-item parcels are not authored.
 * A parcel row stores its sender, subject and body as written here at the time
 * (`fedhex_parcels`), so later copy edits never rewrite mail already delivered.
 */
export const FEDHEX_NAME = "FedHex";

/** The message type of the Legendary Echo recovery parcel, stored on its row. */
export const FEDHEX_ECHO_RECOVERY_MESSAGE_TYPE = "echo_legendary_recovery";

/** The authored sender kind for mail the world itself sends, as opposed to a character. */
export const FEDHEX_NPC_SENDER_KIND = "npc";

/** The exact subject the owner approved for the Echo recovery mail. */
export const FEDHEX_ECHO_RECOVERY_SUBJECT = "Hey, did you drop this? 😏";

/**
 * Short first-person copy from the Wise Old Enby. It never names a pronoun for
 * them (Canon leaves them undecided) and makes no joke of anyone's identity.
 */
export const FEDHEX_ECHO_RECOVERY_BODY =
  "Resonance can be careless with what it hands over. This turned up at the end of your Echo hunt and your pack had no room for it, so I've sent it on through FedHex. Collect it from any FedHex pickup once you've made space. Look after it.";

export function fedhexEchoRecoverySender(): { kind: string; id: string; displayName: string } {
  const sender = getNpc(NPC_IDS.wiseOldEnby);
  if (!sender) throw new Error("The Wise Old Enby must exist to send the Echo recovery parcel");
  return { kind: FEDHEX_NPC_SENDER_KIND, id: sender.id, displayName: sender.displayName };
}
