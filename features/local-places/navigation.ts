/**
 * Local Place navigation is route state, exactly like the Map surface.
 *
 * Putting the open place in the URL is what makes refresh and browser Back
 * behave sensibly without inventing a second persisted character position: the
 * database still says the character is at the parent World Location, and every
 * gameplay command revalidates its own location server-side.
 */
export const LOCAL_PLACE_PARAM = "place";

/** The link that opens one Local Place from its parent location's surface. */
export function localPlaceHref(pathname: string, localPlaceId: string): string {
  return `${pathname}?${LOCAL_PLACE_PARAM}=${encodeURIComponent(localPlaceId)}`;
}
