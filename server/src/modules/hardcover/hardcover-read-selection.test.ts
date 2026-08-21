import { describe, expect, it } from 'vitest';

import {
  attemptOwnedReadId,
  isReadCompatible,
  readTargetForAttempt,
  readTargetForBook,
  selectAdoptableReadId,
  selectPrimaryAttempt,
} from './hardcover-read-selection';

function read(id: number, started_at: string | null, finished_at: string | null) {
  return { id, started_at, finished_at };
}

function attempt(overrides: Partial<Parameters<typeof readTargetForAttempt>[0]> & { id?: number } = {}) {
  return {
    id: 1,
    startedOn: null,
    endedOn: null,
    outcome: null,
    externalProvider: null,
    externalId: null,
    ...overrides,
  } as {
    id: number;
    startedOn: string | null;
    endedOn: string | null;
    outcome: 'completed' | 'skimmed' | 'abandoned' | null;
    externalProvider: string | null;
    externalId: string | null;
  };
}

describe('selectPrimaryAttempt', () => {
  it('returns null when there are no attempts', () => {
    expect(selectPrimaryAttempt([])).toBeNull();
  });

  it('prefers the open attempt over a higher-id closed one', () => {
    const open = attempt({ id: 2, outcome: null });
    const closed = attempt({ id: 9, outcome: 'completed' });

    expect(selectPrimaryAttempt([closed, open])?.id).toBe(2);
  });

  it('falls back to the highest id when no attempt is open', () => {
    const first = attempt({ id: 3, outcome: 'completed' });
    const second = attempt({ id: 7, outcome: 'completed' });

    expect(selectPrimaryAttempt([second, first])?.id).toBe(7);
  });

  it('lets a skimmed or abandoned attempt be primary, since both map to a Hardcover status', () => {
    expect(selectPrimaryAttempt([attempt({ id: 4, outcome: 'skimmed' })])?.id).toBe(4);
    expect(selectPrimaryAttempt([attempt({ id: 5, outcome: 'abandoned' })])?.id).toBe(5);
  });

  it('does not depend on input ordering', () => {
    const attempts = [attempt({ id: 1, outcome: 'completed' }), attempt({ id: 8, outcome: null }), attempt({ id: 4, outcome: 'abandoned' })];

    expect(selectPrimaryAttempt(attempts)?.id).toBe(8);
    expect(selectPrimaryAttempt([...attempts].reverse())?.id).toBe(8);
  });
});

describe('attemptOwnedReadId', () => {
  it('reads the id an attempt already owns', () => {
    expect(attemptOwnedReadId({ externalProvider: 'hardcover', externalId: '555' })).toBe(555);
  });

  it('ignores stamps from other providers', () => {
    expect(attemptOwnedReadId({ externalProvider: 'kobo', externalId: '555' })).toBeNull();
  });

  it('ignores missing or unusable ids', () => {
    expect(attemptOwnedReadId({ externalProvider: 'hardcover', externalId: null })).toBeNull();
    expect(attemptOwnedReadId({ externalProvider: 'hardcover', externalId: 'abc' })).toBeNull();
    expect(attemptOwnedReadId({ externalProvider: 'hardcover', externalId: '0' })).toBeNull();
    expect(attemptOwnedReadId({ externalProvider: 'hardcover', externalId: '-3' })).toBeNull();
  });
});

describe('readTargetForAttempt', () => {
  it('treats only a completed attempt as finished', () => {
    expect(readTargetForAttempt(attempt({ startedOn: '2024-01-01', endedOn: '2024-01-05', outcome: 'completed' }))).toEqual({
      startedOn: '2024-01-01',
      endedOn: '2024-01-05',
      finished: true,
    });
  });

  it('keeps a completed attempt with an unknown finish date open remotely', () => {
    expect(readTargetForAttempt(attempt({ startedOn: '2024-01-01', endedOn: null, outcome: 'completed' }))).toEqual({
      startedOn: '2024-01-01',
      endedOn: null,
      finished: false,
    });
  });

  it('drops the end date for skimmed and abandoned attempts, matching what the sync sends', () => {
    expect(readTargetForAttempt(attempt({ startedOn: '2024-01-01', endedOn: '2024-01-05', outcome: 'skimmed' }))).toEqual({
      startedOn: '2024-01-01',
      endedOn: null,
      finished: false,
    });
    expect(readTargetForAttempt(attempt({ startedOn: '2024-01-01', endedOn: '2024-01-05', outcome: 'abandoned' }))).toEqual({
      startedOn: '2024-01-01',
      endedOn: null,
      finished: false,
    });
  });

  it('treats an open attempt as unfinished', () => {
    expect(readTargetForAttempt(attempt({ startedOn: '2024-02-01', outcome: null }))).toEqual({
      startedOn: '2024-02-01',
      endedOn: null,
      finished: false,
    });
  });
});

describe('readTargetForBook', () => {
  it('is finished exactly when the book has an end date', () => {
    expect(readTargetForBook('2024-01-01', '2024-01-05').finished).toBe(true);
    expect(readTargetForBook('2024-01-01', null).finished).toBe(false);
  });
});

describe('isReadCompatible', () => {
  it('requires open and finished state to agree', () => {
    const openTarget = readTargetForBook('2024-01-01', null);

    expect(isReadCompatible(read(1, '2024-01-01', null), openTarget)).toBe(true);
    expect(isReadCompatible(read(1, '2024-01-01', '2024-01-05'), openTarget)).toBe(false);
  });

  it('rejects a finished read whose end date differs', () => {
    const target = readTargetForBook('2024-01-01', '2024-01-05');

    expect(isReadCompatible(read(1, '2024-01-01', '2024-01-05'), target)).toBe(true);
    expect(isReadCompatible(read(1, '2024-01-01', '2024-02-09'), target)).toBe(false);
  });

  it('rejects a read whose start date differs', () => {
    const target = readTargetForBook('2024-03-01', null);

    expect(isReadCompatible(read(1, '2024-01-01', null), target)).toBe(false);
  });

  it('tolerates dates missing on either side rather than treating absence as evidence', () => {
    expect(isReadCompatible(read(1, null, null), readTargetForBook('2024-01-01', null))).toBe(true);
    expect(isReadCompatible(read(1, '2024-01-01', null), readTargetForBook(null, null))).toBe(true);
  });
});

describe('selectAdoptableReadId', () => {
  const openTarget = readTargetForBook('2024-01-01', null);

  it('returns null when nothing is compatible', () => {
    expect(selectAdoptableReadId([read(1, '2024-01-01', '2024-01-05')], openTarget, new Set())).toBeNull();
  });

  it('skips reads another attempt already owns', () => {
    expect(selectAdoptableReadId([read(555, '2024-01-01', null)], openTarget, new Set([555]))).toBeNull();
  });

  it('adopts a compatible unclaimed read', () => {
    expect(selectAdoptableReadId([read(777, '2024-01-01', null)], openTarget, new Set())).toBe(777);
  });

  it('prefers the candidate with more explicitly matching dates', () => {
    const reads = [read(900, null, null), read(777, '2024-01-01', null)];

    expect(selectAdoptableReadId(reads, openTarget, new Set())).toBe(777);
  });

  it('falls back to the highest id when evidence is equal', () => {
    const reads = [read(777, '2024-01-01', null), read(778, '2024-01-01', null)];

    expect(selectAdoptableReadId(reads, openTarget, new Set())).toBe(778);
  });

  it('matches a completed attempt to its finished read', () => {
    const target = readTargetForAttempt(attempt({ startedOn: '2024-01-01', endedOn: '2024-01-05', outcome: 'completed' }));
    const reads = [read(700, '2024-01-01', '2024-01-05'), read(701, '2024-01-01', null)];

    expect(selectAdoptableReadId(reads, target, new Set())).toBe(700);
  });
});
