export interface ContentFilterRules {
  includeTagIds: number[];
  excludeTagIds: number[];
  includeGenreIds: number[];
  excludeGenreIds: number[];
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
