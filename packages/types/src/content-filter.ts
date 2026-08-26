export interface ContentFilterRules {
  includeTagIds: number[];
  excludeTagIds: number[];
  includeGenreIds: number[];
  excludeGenreIds: number[];
  /**
   * When set, a book that fulfilled a request this user made is exempt from every rule above.
   * Carried on the rules rather than passed alongside them so the ~30 call sites that already
   * thread a `ContentFilterRules` through need no change; absent means today's behaviour.
   */
  exemptRequestsFromUserId?: number;
}

export interface ContentFilterNamedItem {
  id: number;
  name: string;
}

export interface ContentFilterRulesWithNames {
  includeTags: ContentFilterNamedItem[];
  excludeTags: ContentFilterNamedItem[];
  includeGenres: ContentFilterNamedItem[];
  excludeGenres: ContentFilterNamedItem[];
  seeOwnRequestedBooks: boolean;
}

export const EMPTY_CONTENT_FILTER_RULES: ContentFilterRules = {
  includeTagIds: [],
  excludeTagIds: [],
  includeGenreIds: [],
  excludeGenreIds: [],
};

export function isContentFilterEmpty(filters: ContentFilterRules): boolean {
  return (
    filters.includeTagIds.length === 0 &&
    filters.excludeTagIds.length === 0 &&
    filters.includeGenreIds.length === 0 &&
    filters.excludeGenreIds.length === 0
  );
}
