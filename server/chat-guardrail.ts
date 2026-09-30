import { createHash } from "node:crypto";
import { chatGuardrailTokens } from "@/game/domain/chat";

/**
 * The deterministic severe-slur guardrail for player-authored chat
 * (issue #246): General, Trade, and promoted Trade ads, and later Whispers.
 *
 * A match refuses the send before anything is persisted or delivered, with a
 * clear message. It is a send guardrail only — it never records a strike,
 * warning, restriction, or any finding about the sender. Ordinary profanity is
 * deliberately not listed; this is not a toxicity classifier.
 *
 * Matching is whole-token equality after `chatGuardrailTokens` folding, never
 * substring or fuzzy, so ordinary words that contain a listed term pass.
 *
 * The list is kept as SHA-256 digests of the folded terms so this public
 * repository neither spells the slurs out nor publishes an evasion checklist.
 * Configure it here: to add a term, fold it by hand the way
 * `chatGuardrailTokens` does (lowercase, no diacritics, leetspeak digits
 * written as letters) and append
 * `printf '%s' '<term>' | sha256sum`; list plural or variant spellings as
 * their own entries. `severeTermDigest` computes the same value in code.
 *
 * The current list covers only unequivocal severe slurs with no common benign
 * meaning — racial, ethnic, antisemitic, and anti-gay slurs and their plurals.
 * Words with ordinary everyday senses are intentionally excluded.
 */
export const SEVERE_TERM_DIGESTS: ReadonlySet<string> = new Set([
  "120f6e5b4ea32f65bda68452fcfaaef06b0136e1d0e4a6f60bc3771fa0936dd6",
  "5b3ae48be122f7ed19b4cc587649f41f9d2565df51cfa332f8e7806f4ebb9032",
  "08a841e996781e9e77d30a4e4420a8f501a280b00624e6d1224bf54aaff73eba",
  "341d56384afc0f47b34ca18273e793be555507a49444c30d3d0588688de46cb3",
  "87d1690e74a1d8276d11401dc3da66b774e8f1cade9758b9ddf8737166ca73b7",
  "dc675e448132fd2a4fed47c1736784e83fe01e8cf137dcf97cca9fc7e337e8b4",
  "e793d67686f2824f67dd73b1c955a74095b7fc54ae95c7e1b4fde436e27d15a9",
  "c3de533e9b7fe63b79f648687a30d2861edd92fe7c3cd1f2c485e0a605367624",
  "268651b3ece980102f18871fde07189372961e056f858ca147a28d004f876b03",
  "8f5083e3e5c7dc8932f2bf58212f963f3a44752618c96297f82623f736c52738",
  "1e02eec4f1095143be282056557034d4e8ab915342c1af508223141d472d2347",
  "98b52c4b6b7d1f48e7477a5ccc10955dd195d0ac5a38c8281bfeb08762634909",
  "044eb98b18769b887d5a0258f675e413058b8e9fc9b9786b418bfc6f03f26c98",
  "eef3bd091670c3447022d619c06ad15de96da72b5a66f28bb8b75d1b1c12a05f",
  "0ce875d620076b533c6e681abaa0dc5d9a941366bb000a02ec5351f341b96c61",
  "cc02032349c833ac5e97bac094560ed40e09acf34cb1978ab7a9840b9bf15b4d",
  "82159dd02870c13ec30e4f146db7c317aca568469d0e7e22b8610a2eaa3d3924",
  "22fc75e65a0e9d34324092a7c6a8dba961853294abca4e5914e60c550f48e0c2",
  "17a110e5332848721f27510e1e2bca710a321663bb8a5632e0e46a820fc9e28a",
  "333f7618092958c75b8c5af6f1ec77b42803922a0fc6ff1570a8af3a3aab3b4a",
  "da0a6b1b9213d48ff10cc45733cc8a925dbd2afb26320ed488ac2efa9a8ae33a",
  "12e6274e4309293e2d480272b49a6c7c73a6a6b22678ba226b533c67006c17d1",
  "bb209d506bb8b17815af0e50923c3d8f65985dab91083f026f1881a7430c5cc7",
]);

/** The digest a folded single-token term is listed under. */
export function severeTermDigest(term: string): string {
  return createHash("sha256").update(chatGuardrailTokens(term).join(" ")).digest("hex");
}

/** True when any whole token of `text` is a listed severe term. */
export function containsSevereTerm(
  text: string,
  digests: ReadonlySet<string> = SEVERE_TERM_DIGESTS,
): boolean {
  return chatGuardrailTokens(text).some((token) =>
    digests.has(createHash("sha256").update(token).digest("hex")),
  );
}
