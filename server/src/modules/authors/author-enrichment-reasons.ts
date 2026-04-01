export const AUTHOR_ENRICHMENT_REASONS = {
  UNKNOWN: 'unknown',
  METADATA_REPLACE: 'metadata_replace',
  MANUAL_BACKFILL: 'manual_backfill',
  MANUAL_BACKFILL_ALL: 'manual_backfill_all',
  AUTHOR_RENAME: 'author_rename',
  AUTHOR_MERGE_TARGET: 'author_merge_target',
} as const;

export type AuthorEnrichmentReason = (typeof AUTHOR_ENRICHMENT_REASONS)[keyof typeof AUTHOR_ENRICHMENT_REASONS];
