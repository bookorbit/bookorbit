import type { EntityType } from '@bookorbit/types';

export interface RawCandidatePair {
  idA: number | string;
  idB: number | string;
  nameA: string;
  nameB: string;
  simScore: number;
  sortNameA?: string | null;
  sortNameB?: string | null;
  hasPhotoA?: boolean;
  hasPhotoB?: boolean;
}

export interface BrowseParams {
  libraryIds: number[];
  search?: string;
  page: number;
  pageSize: number;
  sortBy: 'name' | 'bookCount';
  sortOrder: 'asc' | 'desc';
  contentFilters?: import('@bookorbit/types').ContentFilterRules;
}

export interface BrowseResult {
  items: { id: number | string; name: string; bookCount: number; sortName?: string | null; hasPhoto?: boolean }[];
  total: number;
}

export interface MergeInput {
  targetId: number | string;
  sourceIds: (number | string)[];
  userId: number;
  libraryIds?: number[];
}

export interface StrategyMergeResult {
  affectedBookIds: number[];
  imagePromoted?: boolean;
  fieldsResolved?: string[];
}

export interface RenameInput {
  entityId: number | string;
  newName: string;
  userId: number;
  libraryIds: number[];
}

export interface StrategyRenameResult {
  oldName: string;
  affectedBookIds: number[];
  wasImplicitMerge: boolean;
  mergedEntityId?: number | string;
}

export interface DeleteInput {
  entityId: number | string;
  mode: 'soft' | 'hard' | 'inline';
  libraryIds: number[];
}

export interface StrategyDeleteResult {
  name: string;
  affectedBookIds: number[];
}

export interface SplitInput {
  entityId: number;
  newNames: string[];
}

export interface StrategySplitResult {
  originalName: string;
  newEntities: { id: number; name: string }[];
  affectedBookIds: number[];
}

export interface EntityStrategy {
  readonly entityType: EntityType;
  readonly isInline: boolean;

  findCandidatePairs(libraryIds: number[], minSimilarity: number): Promise<RawCandidatePair[]>;

  getAllEntityIds?(): Promise<number[]>;

  computeCandidatePairsForBatch?(outerIds: number[], minSimilarity: number): Promise<RawCandidatePair[]>;

  browse(params: BrowseParams): Promise<BrowseResult>;

  merge(input: MergeInput): Promise<StrategyMergeResult>;
  rename(input: RenameInput): Promise<StrategyRenameResult>;
  deleteEntity(input: DeleteInput): Promise<StrategyDeleteResult>;
  split(input: SplitInput): Promise<StrategySplitResult>;

  findAffectedBookIds(ids: (number | string)[]): Promise<number[]>;
  getBookCount(id: number | string): Promise<number>;
  getBookTitles(id: number | string, limit: number): Promise<string[]>;
  findEntityById(id: number | string): Promise<{ id: number | string; name: string } | null>;
}
