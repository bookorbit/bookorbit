export interface GoodreadsNextData {
  props: {
    pageProps: {
      apolloState: Record<string, unknown>;
    };
  };
}

// Returned by the public /book/auto_complete JSON endpoint. Unlike the detail
// page, this endpoint is not gated behind the AWS WAF challenge, so it is the
// fallback source when the detail-page scrape is blocked.
export interface GoodreadsAutocompleteItem {
  bookId?: string | number;
  workId?: string | number;
  bookUrl?: string;
  title?: string;
  bookTitleBare?: string;
  author?: string | { name?: string };
  numPages?: string | number;
  avgRating?: string | number;
  ratingsCount?: string | number;
  imageUrl?: string;
  description?: { html?: string; truncated?: boolean } | string;
}

// Inline nested objects, not __ref pointers.
export interface GoodreadsApolloBook {
  legacyId?: string | number;
  title?: string;
  description?: string;
  imageUrl?: string;
  details?: GoodreadsApolloDetails;
  bookGenres?: Array<{ genre?: { name?: string } }>;
  bookSeries?: Array<{
    userPosition?: string;
    series?: { __ref?: string; title?: string };
  }>;
  primaryContributorEdge?: { node?: { __ref?: string }; role?: string };
  work?: { __ref?: string };
}

export interface GoodreadsApolloDetails {
  numPages?: string | number;
  publicationTime?: string | number;
  publisher?: string;
  isbn?: string;
  isbn13?: string;
  language?: { name?: string };
}

// Found by scanning root apolloState for keys starting with these prefixes
export interface GoodreadsApolloContributor {
  name?: string;
}

export interface GoodreadsApolloSeries {
  title?: string;
}

export interface GoodreadsApolloWork {
  stats?: {
    averageRating?: string | number;
    ratingsCount?: string | number;
  };
}
