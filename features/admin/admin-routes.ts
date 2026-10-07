/**
 * The route of the operator inspector for one character. A pure string builder
 * shared by the console's character search and the admin-only link on the
 * Character surface (#333), so the path has one home. It grants nothing: the
 * page and every command behind it authorize the request independently.
 */
export function adminCharacterInspectorHref(characterId: string): string {
  return `/admin/characters/${encodeURIComponent(characterId)}`;
}
