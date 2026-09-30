/**
 * Where RuneSpace's published player policies live (issue #248): the Chat &
 * Community Rules and the Safety & Privacy disclosure are Wiki articles, and
 * sanction notices, the Chat/Social drawer, the public footer, and Updates
 * link to them through these paths. A unit test keeps each slug pointing at a
 * real authored article.
 */
export const COMMUNITY_RULES_SLUG = "community-rules";
export const SAFETY_PRIVACY_SLUG = "safety-and-privacy";

export const COMMUNITY_RULES_PATH = `/wiki/${COMMUNITY_RULES_SLUG}`;
export const SAFETY_PRIVACY_PATH = `/wiki/${SAFETY_PRIVACY_SLUG}`;
