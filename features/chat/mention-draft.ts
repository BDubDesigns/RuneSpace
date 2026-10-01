import { CHARACTER_NAME_MAX, normalizeCharacterName } from "@/game/domain/character-name";
import { CHAT_POLICY, mentionSpans, mentionText, namesShownAsMentions } from "@/game/domain/chat";
import type { ChatMentionView } from "@/game/schemas/chat";
import type { CharacterTarget } from "@/game/schemas/whispers";

/**
 * Browser-side `@mention` drafting (issue #261). Framework-free so it is
 * unit-testable; `ChatComposer` and `PublicChat` own the React wiring.
 *
 * A mention is made only by choosing a character from the composer's list
 * after `@`: the choice records its target and inserts `@Name`. Typing the
 * same text by hand makes nothing. The server re-resolves every target and
 * refuses a send whose body no longer shows the chosen name, so this module
 * is convenience, never authority.
 */

/**
 * One character the composer can offer: someone already visible or relevant
 * to the player — a recent General/Trade sender, a Nearby Player, or a Whisper
 * peer. Never a global directory.
 */
export type MentionCandidate = {
  /** The character's current name, exactly as it will be inserted. */
  name: string;
  /** How the server finds it: a stable id, or a Nearby Player's exact name. */
  target: CharacterTarget;
};

/** The `@query` the caret is in, or undefined when it is not in one. */
export type MentionQuery = { start: number; query: string };

/**
 * The mention being typed at `caret`: an `@` at the start of the draft or after
 * whitespace, followed by at most a name's length of text on the same line.
 * Names may contain spaces, so the query may too; it simply stops matching.
 */
export function activeMentionQuery(draft: string, caret: number): MentionQuery | undefined {
  const before = draft.slice(0, caret);
  const at = before.lastIndexOf("@");
  if (at === -1) return undefined;
  if (at > 0 && !/\s/.test(before[at - 1]!)) return undefined;
  const query = before.slice(at + 1);
  if (query.includes("\n") || Array.from(query).length > CHARACTER_NAME_MAX) return undefined;
  return { start: at, query };
}

/**
 * Fold for prefix matching: Unicode-compatible and case-insensitive like the
 * character-name key, but untrimmed, so `@Bob ` (just inserted) no longer
 * matches `Bob` while `@Bob S` still matches `Bob Smith`.
 */
function foldForPrefix(text: string): string {
  return text.normalize("NFKC").toLowerCase().replace(/\s+/g, " ");
}

/**
 * Candidates whose name starts with the query, compared the way character
 * names are (Unicode-folded, case-insensitive), at most `limit`. Order is the
 * candidates' own: most relevant first.
 */
export function matchMentionCandidates(
  candidates: readonly MentionCandidate[],
  query: string,
  limit = 6,
): MentionCandidate[] {
  const folded = foldForPrefix(query);
  const matches: MentionCandidate[] = [];
  for (const candidate of candidates) {
    if (foldForPrefix(candidate.name).startsWith(folded)) matches.push(candidate);
    if (matches.length === limit) break;
  }
  return matches;
}

/**
 * Merge candidate sources in priority order into one list, one entry per
 * character name (names are globally unique), dropping `excludeNames`. The
 * first source to offer a name wins, so list id-backed sources first.
 */
export function mergeMentionCandidates(
  sources: readonly (readonly MentionCandidate[])[],
  excludeNames: readonly string[] = [],
): MentionCandidate[] {
  const seen = new Set(excludeNames.map(normalizeCharacterName));
  const merged: MentionCandidate[] = [];
  for (const source of sources) {
    for (const candidate of source) {
      const key = normalizeCharacterName(candidate.name);
      if (seen.has(key)) continue;
      seen.add(key);
      merged.push(candidate);
    }
  }
  return merged;
}

/**
 * Replace the `@query` from `start` to `caret` with `@Name ` and return the
 * new draft and where the caret goes.
 */
export function insertMention(
  draft: string,
  start: number,
  caret: number,
  name: string,
): { draft: string; caret: number } {
  const inserted = `${mentionText(name)} `;
  return {
    draft: draft.slice(0, start) + inserted + draft.slice(caret),
    caret: start + inserted.length,
  };
}

/**
 * The chosen mentions the draft still shows, one per character, by the same
 * span rule the server applies (`mentionSpans`): editing `@Name` out of the
 * text, or into a longer name, drops its mention. Not capped: the composer
 * stops offering names at the limit, and the server refuses more.
 */
export function mentionsShown(
  draft: string,
  chosen: readonly MentionCandidate[],
): MentionCandidate[] {
  const visible = namesShownAsMentions(
    draft,
    chosen.map((candidate) => candidate.name),
  );
  const shown = new Map<string, MentionCandidate>();
  for (const candidate of chosen) {
    if (visible.has(candidate.name)) shown.set(normalizeCharacterName(candidate.name), candidate);
  }
  return [...shown.values()];
}

/** Whether a draft already shows as many mentions as one message may carry. */
export function atMentionLimit(draft: string, chosen: readonly MentionCandidate[]): boolean {
  return mentionsShown(draft, chosen).length >= CHAT_POLICY.maxMentions;
}

/** One run of a rendered message body: plain text, or a resolved mention. */
export type BodySegment = { text: string; mention?: ChatMentionView };

/**
 * Split a message body into text and the mentions the server resolved, by
 * each mention's name at send and the same span rule the server checked.
 * Only those names are marked: other `@` text in the body stays plain.
 */
export function mentionSegments(body: string, mentions: readonly ChatMentionView[]): BodySegment[] {
  if (mentions.length === 0) return [{ text: body }];
  const byName = new Map(mentions.map((mention) => [mention.name, mention]));
  const segments: BodySegment[] = [];
  let at = 0;
  for (const span of mentionSpans(body, [...byName.keys()])) {
    if (span.start > at) segments.push({ text: body.slice(at, span.start) });
    segments.push({ text: body.slice(span.start, span.end), mention: byName.get(span.name) });
    at = span.end;
  }
  if (at < body.length) segments.push({ text: body.slice(at) });
  return segments;
}
