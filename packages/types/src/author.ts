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

export type AuthorEnrichmentStatus = {
  queued: number;
  processing: number;
  rateLimited: number;
  failed: number;
  done: number;
  total: number;
};

export type AuthorEnrichmentStatusEvent = AuthorEnrichmentStatus & {
  paused: boolean;
  sessionTotal: number;
  sessionDone: number;
  currentItemName: string | null;
};

export type AuthorEnrichmentFailedItem = {
  authorId: number;
  name: string | null;
  error: string | null;
  httpStatus: number | null;
  failedAt: string;
};

export type AuthorEnrichmentFailedPage = {
  items: AuthorEnrichmentFailedItem[];
  total: number;
  page: number;
  limit: number;
};

export const AuthorAutoEnrichmentWriteMode = {
  MISSING_ONLY: 'missing_only',
  ALWAYS_REFETCH: 'always_refetch',
} as const;

export type AuthorAutoEnrichmentWriteMode =
  (typeof AuthorAutoEnrichmentWriteMode)[keyof typeof AuthorAutoEnrichmentWriteMode];

export type AuthorEnrichmentConditions = {
  neverEnriched: boolean;
  missingBio: boolean;
  missingPhoto: boolean;
};

export type AuthorAutoEnrichmentConfig = {
  enabled: boolean;
  triggerOnImport: boolean;
  writeMode: AuthorAutoEnrichmentWriteMode;
  conditions: AuthorEnrichmentConditions;
};
