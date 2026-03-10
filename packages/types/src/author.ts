import type { BooksPage } from './book';

export type AuthorSummary = {
  id: number;
  name: string;
  sortName: string | null;
  description?: string | null;
  imageUrl?: string | null;
  bookCount: number;
  lastAddedAt: string | null;
};

export type AuthorDetail = AuthorSummary & {
  description: string | null;
};

export type AuthorsPage = {
  items: AuthorSummary[];
  total: number;
  page: number;
  size: number;
};

export type AuthorBooksPage = BooksPage;

export type MergeAuthorsResult = {
  target: AuthorDetail;
  mergedAuthorIds: number[];
  affectedBookCount: number;
};

export type AuthorDuplicateSuggestion = {
  left: AuthorSummary;
  right: AuthorSummary;
  confidence: number;
  reasons: string[];
};

export type AuthorInsightsRow = {
  id: number;
  name: string;
  bookCount: number;
  lastAddedAt: string | null;
  metric: number;
  secondaryMetric?: number | null;
};

export type AuthorInsights = {
  generatedAt: string;
  windowDays: number;
  newAuthors: AuthorInsightsRow[];
  mostRead: AuthorInsightsRow[];
  unreadBacklog: AuthorInsightsRow[];
};

export const AuthorMetadataProviderKey = {
  AUDNEXUS: 'audnexus',
} as const;

export type AuthorMetadataProviderKey = (typeof AuthorMetadataProviderKey)[keyof typeof AuthorMetadataProviderKey];

export type AuthorMetadataCandidate = {
  provider: AuthorMetadataProviderKey;
  providerId: string;
  name: string;
  description?: string;
  imageUrl?: string;
  sourceUrl?: string;
};

export type AuthorMetadataProviderInfo = {
  key: AuthorMetadataProviderKey;
  label: string;
  identifiable: boolean;
};
