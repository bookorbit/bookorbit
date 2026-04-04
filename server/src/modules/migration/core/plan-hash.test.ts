import { describe, expect, it } from 'vitest';

import { buildPlanHash, buildSourceSnapshotHash } from './plan-hash';

describe('buildPlanHash', () => {
  it('ignores volatile generatedAt fields in plan hashing', () => {
    const sourceSnapshotHash = 'snapshot-hash';
    const profileHash = 'profile-hash';

    const left = buildPlanHash({
      sourceSnapshotHash,
      profileHash,
      plan: {
        generatedAt: '2026-01-01T00:00:00.000Z',
        snapshot: {
          generatedAt: '2026-01-01T00:00:00.000Z',
          counts: { books: 1 },
        },
        matchedBooks: [{ sourceBookId: 's1', targetBookId: 10, strategy: 'isbn' }],
      },
    });

    const right = buildPlanHash({
      sourceSnapshotHash,
      profileHash,
      plan: {
        generatedAt: '2030-01-01T00:00:00.000Z',
        snapshot: {
          generatedAt: '2030-01-01T00:00:00.000Z',
          counts: { books: 1 },
        },
        matchedBooks: [{ sourceBookId: 's1', targetBookId: 10, strategy: 'isbn' }],
      },
    });

    expect(left).toBe(right);
  });
});

describe('buildSourceSnapshotHash', () => {
  it('ignores generatedAt in source snapshot hashing', () => {
    const left = buildSourceSnapshotHash({
      generatedAt: '2026-01-01T00:00:00.000Z',
      sourceType: 'booklore',
      counts: { books: 10 },
    });

    const right = buildSourceSnapshotHash({
      generatedAt: '2030-01-01T00:00:00.000Z',
      sourceType: 'booklore',
      counts: { books: 10 },
    });

    expect(left).toBe(right);
  });
});
