import type { BookQuery, SortField, SortSpec } from "./query";

export type JumpBucketKind = "letter" | "temporal" | "category";

export type TemporalJumpBucketUnit = "day" | "month" | "year";

export type TemporalJumpBucketGranularity = {
  unit: TemporalJumpBucketUnit;
  step: number;
};

/**
 * One jump target on the rail. `index` is the absolute 0-based row index of the
 * first book in this bucket under the listing's exact sort order, so a jump is
 * just scroll-to-index. Buckets are returned in display order (already reversed
 * for descending sorts).
 */
export type JumpBucket = {
  key: string;
  label: string;
  index: number;
  isUnknown?: boolean;
};

export type JumpBucketsResponse = {
  buckets: JumpBucket[];
  total: number;
  kind: JumpBucketKind;
  granularity: TemporalJumpBucketGranularity | null;
};

export type JumpBucketsQuery = BookQuery & {
  maxBuckets: number;
};

export type TemporalJumpBucketPrecision = "date" | "year";

export type JumpRailStrategy = { kind: "letter" } | { kind: "temporal"; precision: TemporalJumpBucketPrecision } | { kind: "category" };

const STRATEGY_BY_PRIMARY_SORT_FIELD: Partial<Record<SortField, JumpRailStrategy>> = {
  title: { kind: "letter" },
  author: { kind: "letter" },
  series: { kind: "letter" },
  publisher: { kind: "letter" },
  addedAt: { kind: "temporal", precision: "date" },
  updatedAt: { kind: "temporal", precision: "date" },
  publishedDate: { kind: "temporal", precision: "year" },
  publishedYear: { kind: "temporal", precision: "year" },
  lastReadAt: { kind: "temporal", precision: "date" },
  startedAt: { kind: "temporal", precision: "date" },
  finishedAt: { kind: "temporal", precision: "date" },
  language: { kind: "category" },
  format: { kind: "category" },
  readStatus: { kind: "category" },
};

export function jumpRailStrategyForSort(sort: SortSpec[]): JumpRailStrategy | null {
  const primary = sort[0] ?? { field: "title", dir: "asc" };
  return STRATEGY_BY_PRIMARY_SORT_FIELD[primary.field] ?? null;
}

/**
 * Single source of truth for rail eligibility, shared by the client (gate the
 * rail and bucket fetches) and the server (validate + pick bucket expression).
 * Only the primary sort field matters: secondary sorts reorder rows within
 * equal primary values and cannot move bucket boundaries. An empty sort means
 * title ascending, mirroring the server's default.
 */
export function jumpBucketKindForSort(sort: SortSpec[]): JumpBucketKind | null {
  return jumpRailStrategyForSort(sort)?.kind ?? null;
}

export function temporalJumpBucketPrecisionForSort(sort: SortSpec[]): TemporalJumpBucketPrecision | null {
  const strategy = jumpRailStrategyForSort(sort);
  return strategy?.kind === "temporal" ? strategy.precision : null;
}
