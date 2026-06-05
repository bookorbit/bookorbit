export interface GoodreadsNextData {
  props: {
    pageProps: {
      apolloState: Record<string, unknown>;
    };
  };
}

// Inline nested objects — NOT __ref pointers
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
