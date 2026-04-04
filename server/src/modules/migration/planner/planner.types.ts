import type { SourceExportData, SourceSnapshot } from '../adapters/source-adapter.types';

export interface PathMapping {
  sourcePrefix: string;
  targetPrefix: string;
}

export interface UserMapping {
  sourceUserId: string;
  targetUserId: number;
}

export type MatchStrategy = 'isbn' | 'file_hash' | 'path_mapping' | 'title_author';

export type UnresolvedReasonCode =
  | 'insufficient_source_data'
  | 'no_isbn_match'
  | 'no_file_hash_match'
  | 'no_file_path_match'
  | 'no_title_author_match';

export interface PlannedBookMatch {
  sourceBookId: string;
  targetBookId: number;
  strategy: MatchStrategy;
}

export interface PlannedDuplicateBookMatch {
  targetBookId: number;
  sourceBookIds: string[];
  strategies: MatchStrategy[];
  reason: 'duplicate_target_match';
}

export interface PlannedUnresolvedBook {
  sourceBookId: string;
  title: string | null;
  reason: UnresolvedReasonCode;
}

export interface UserPreviewCounts {
  statuses: number;
  fileProgress: number;
  bookmarks: number;
  annotations: number;
  shelves: number;
}

export interface PlannedUserPreview {
  sourceUserId: string;
  targetUserId: number;
  username: string;
  counts: UserPreviewCounts;
}

export interface PlannedMigration {
  generatedAt: string;
  snapshot: SourceSnapshot;
  matchingPriority: MatchStrategy[];
  userMappings: UserMapping[];
  pathMappings: PathMapping[];
  scope: Record<string, unknown>;
  matchedBooks: PlannedBookMatch[];
  unresolvedBooks: PlannedUnresolvedBook[];
  duplicateBookMatches: PlannedDuplicateBookMatch[];
  userPreview: PlannedUserPreview[];
}

export interface PlannedExecutionContext {
  sourceData: SourceExportData;
  matchedBooks: PlannedBookMatch[];
  unresolvedBooks: PlannedUnresolvedBook[];
  duplicateBookMatches: PlannedDuplicateBookMatch[];
}

export interface PlannerResult {
  plan: PlannedMigration;
  execution: PlannedExecutionContext;
}
