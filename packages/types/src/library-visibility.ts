/**
 * Places a user can hide a library from. Hiding only leaves the library out when the place reads
 * "all libraries": the sidebar, search, the library's own page and an explicit library filter
 * still show it.
 */
export const LIBRARY_VISIBILITY_PLACES = ["shelves", "series", "stats"] as const;

export type LibraryVisibilityPlace = (typeof LIBRARY_VISIBILITY_PLACES)[number];

/**
 * Stored as libraries to hide rather than libraries to show, so a library created later shows
 * everywhere until the user hides it.
 */
export interface LibraryVisibilitySettings {
  hidden?: Partial<Record<LibraryVisibilityPlace, number[]>>;
}
