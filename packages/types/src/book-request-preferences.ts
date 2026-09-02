/**
 * What a user's requests start with, so it is not re-picked on every request.
 *
 * Destinations are deliberately not here. They were, pinned per user and then per medium, but the
 * instance default under Settings > System > Requests answers the same question for everybody
 * without each person having to find a pin button, and two mechanisms answering it with an
 * invisible precedence rule between them was worse than one.
 */
export interface BookRequestPreferences {
  /**
   * The language a new request asks for, as a two-letter code.
   *
   * Null means "whatever the chosen edition happens to be", which is what every request did before
   * this existed: the edition's language rode along silently and decided the outcome, so a request
   * for a book could come back as a translation nobody asked for.
   *
   * Still per user, unlike the destination, because there is no instance-level answer to it: the
   * language someone reads in is theirs, not the server's.
   */
  defaultLanguage: string | null;
}

export const DEFAULT_BOOK_REQUEST_PREFERENCES: BookRequestPreferences = {
  defaultLanguage: null,
};

/**
 * Fields this category used to hold: first one destination for every medium, then one per medium.
 * Read only to be discarded, so a row written by either older build still parses and keeps its
 * language instead of failing strict validation and reverting to the defaults.
 */
export const RETIRED_BOOK_REQUEST_PREFERENCE_FIELDS = ["defaultLibraryId", "defaultFolderId", "destinations"] as const;
