export type EntityType = "author" | "genre" | "tag" | "narrator" | "publisher" | "language" | "series";
export type FirstClassEntityType = "author" | "genre" | "tag" | "narrator" | "series";
export type InlineEntityType = "publisher" | "language";

export const FIRST_CLASS_ENTITY_TYPES: readonly FirstClassEntityType[] = ["author", "genre", "tag", "narrator", "series"] as const;
export const INLINE_ENTITY_TYPES: readonly InlineEntityType[] = ["publisher", "language"] as const;
export const ALL_ENTITY_TYPES: readonly EntityType[] = [...FIRST_CLASS_ENTITY_TYPES, ...INLINE_ENTITY_TYPES] as const;

export interface EntityTypeCapabilities {
  canSplit: boolean;
  hasSoftDelete: boolean;
  hasPhoto: boolean;
  hasSortName: boolean;
}

export const ENTITY_CAPABILITIES: Record<EntityType, EntityTypeCapabilities> = {
  author: { canSplit: true, hasSoftDelete: true, hasPhoto: true, hasSortName: true },
  genre: { canSplit: true, hasSoftDelete: true, hasPhoto: false, hasSortName: false },
  tag: { canSplit: true, hasSoftDelete: true, hasPhoto: false, hasSortName: false },
  narrator: { canSplit: true, hasSoftDelete: true, hasPhoto: false, hasSortName: true },
  publisher: { canSplit: false, hasSoftDelete: false, hasPhoto: false, hasSortName: false },
  language: { canSplit: false, hasSoftDelete: false, hasPhoto: false, hasSortName: false },
  series: { canSplit: false, hasSoftDelete: false, hasPhoto: false, hasSortName: false },
};

// Browse
export interface BrowseEntityItem {
  id: number | string;
  name: string;
  bookCount: number;
  sortName?: string | null;
  hasPhoto?: boolean;
}

export interface BrowseEntitiesResponse {
  items: BrowseEntityItem[];
  total: number;
  page: number;
  pageSize: number;
}

// Duplicate cluster
export interface DuplicateCluster {
  clusterId: string;
  entities: ClusterEntity[];
  averageSimilarity: number;
  suggestedTargetId: number | string;
  pairDetails: PairDetail[];
}

export interface ClusterEntity {
  id: number | string;
  name: string;
  bookCount: number;
  bookTitles: string[];
  sortName?: string | null;
  hasPhoto?: boolean;
}

export interface PairDetail {
  idA: number | string;
  idB: number | string;
  similarity: number;
  reasons: string[];
}

export interface DuplicateScanResponse {
  entityType: EntityType;
  clusters: DuplicateCluster[];
  totalEntities: number;
  total: number;
  page: number;
  pageSize: number;
}

export type DuplicateScanState = "idle" | "computing" | "done" | "error";

export interface DuplicateScanStatus {
  entityType: EntityType;
  state: DuplicateScanState;
  computedAt: string | null;
  totalPairs: number | null;
  threshold: number | null;
  progressPct: number | null;
}

// Operation results
export interface MergeResult {
  targetId: number | string;
  mergedIds: (number | string)[];
  affectedBookCount: number;
  imagePromoted?: boolean;
  fieldsResolved?: string[];
}

export interface RenameResult {
  entityId: number | string;
  oldName: string;
  newName: string;
  affectedBookCount: number;
  wasImplicitMerge: boolean;
  mergedEntityId?: number | string;
}

export interface DeleteResult {
  entityId: number | string;
  name: string;
  affectedBookCount: number;
  mode: "soft" | "hard" | "inline";
}

export interface SplitResult {
  originalId: number;
  originalName: string;
  newEntities: { id: number; name: string }[];
  affectedBookCount: number;
}

export interface BulkDeleteResult {
  results: DeleteResult[];
  errors: { entityId: number | string; error: string }[];
}

// Dismissed pair
export interface DismissedPairInfo {
  id: number;
  entityType: EntityType;
  nameA: string;
  nameB: string;
  idA: number | string;
  idB: number | string;
  reason?: string | null;
  dismissedAt: string;
}

// Entity info (for modals)
export interface EntityInfo {
  id: number | string;
  name: string;
  bookCount: number;
  bookTitles: string[];
}
