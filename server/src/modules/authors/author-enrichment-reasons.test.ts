import { AUTHOR_ENRICHMENT_REASONS } from './author-enrichment-reasons';

describe('AUTHOR_ENRICHMENT_REASONS', () => {
  it('exposes stable reason keys used by queue scheduling flows', () => {
    expect(AUTHOR_ENRICHMENT_REASONS).toEqual({
      UNKNOWN: 'unknown',
      METADATA_REPLACE: 'metadata_replace',
      MANUAL_BACKFILL: 'manual_backfill',
      MANUAL_BACKFILL_ALL: 'manual_backfill_all',
      AUTHOR_RENAME: 'author_rename',
      AUTHOR_MERGE_TARGET: 'author_merge_target',
    });
  });
});
