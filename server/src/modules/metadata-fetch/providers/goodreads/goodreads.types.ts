export interface GoodreadsNextData {
  props: {
    pageProps: {
      apolloState: Record<string, unknown>;
    };
  };
}

export interface Ref {
  __ref: string;
}

export interface GoodreadsApolloBook {
  title?: string;
  imageUrl?: string;
  description?: Ref;
  bookGenres?: Array<{ genre?: Ref }>;
  details?: Ref;
  primaryContributorEdge?: Ref;
  secondaryContributorEdges?: Ref[];
  bookSeries?: Ref[];
  work?: Ref;
}

export interface GoodreadsApolloBookDetails {
  publisher?: string;
  publicationTime?: number;
  language?: { name?: string };
  numPages?: number;
  isbn?: string;
  isbn13?: string;
}

export interface GoodreadsApolloContributorEdge {
  node?: Ref;
  role?: string;
}

export interface GoodreadsApolloContributor {
  name?: string;
}

export interface GoodreadsApolloGenre {
  name?: string;
}

export interface GoodreadsApolloBookSeries {
  series?: Ref;
  userPosition?: string;
}

export interface GoodreadsApolloSeries {
  title?: string;
}

export interface GoodreadsApolloWork {
  stats?: Ref;
}

export interface GoodreadsApolloTruncatedHtml {
  fullContent?: string;
  truncatedContent?: string;
}
