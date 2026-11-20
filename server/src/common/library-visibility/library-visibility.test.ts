import { describe, expect, it, vi } from 'vitest';

import { makeUser } from '../test-utils/make-user';
import { hiddenLibrariesCacheKey, hiddenLibraryIds, visibleIdsOrAllForPlace, withoutHiddenLibraries } from './library-visibility';

function userHiding(hidden: unknown) {
  return makeUser({ settings: { libraryVisibility: { hidden } } });
}

function scope(visibleIds: number[], visibleIdsOrAll: number[] | null) {
  return { visibleIds: vi.fn().mockResolvedValue(visibleIds), visibleIdsOrAll: vi.fn().mockResolvedValue(visibleIdsOrAll) };
}

describe('library visibility', () => {
  it('reads the libraries hidden from one place, deduplicated and sorted', () => {
    const user = userHiding({ stats: [7, 2, 7], series: [3] });

    expect(hiddenLibraryIds(user, 'stats')).toEqual([2, 7]);
    expect(hiddenLibraryIds(user, 'series')).toEqual([3]);
    expect(hiddenLibraryIds(user, 'shelves')).toEqual([]);
  });

  it.each([undefined, null, 'stats', [], { stats: 'all' }, { stats: [0, -1, 1.5, Number.NaN, '4'] }])(
    'reads unusable settings as nothing hidden: %j',
    (hidden) => {
      expect(hiddenLibraryIds(userHiding(hidden), 'stats')).toEqual([]);
    },
  );

  it('reads a user without the setting as nothing hidden', () => {
    expect(hiddenLibraryIds(makeUser(), 'stats')).toEqual([]);
    expect(hiddenLibraryIds(makeUser({ settings: { libraryVisibility: ['stats'] } }), 'stats')).toEqual([]);
  });

  it('drops hidden libraries and keeps the order of the rest', () => {
    expect(withoutHiddenLibraries([5, 1, 3], userHiding({ shelves: [1] }), 'shelves')).toEqual([5, 3]);
    expect(withoutHiddenLibraries([5, 1, 3], userHiding({ shelves: [1] }), 'series')).toEqual([5, 1, 3]);
  });

  it('builds a cache key that changes with what is hidden', () => {
    expect(hiddenLibrariesCacheKey(userHiding({ stats: [9, 2] }), 'stats')).toBe('2,9');
    expect(hiddenLibrariesCacheKey(makeUser(), 'stats')).toBe('');
  });

  it('keeps the all-libraries answer when nothing is hidden', async () => {
    const libraryScope = scope([1, 2], null);

    await expect(visibleIdsOrAllForPlace(libraryScope, makeUser({ isSuperuser: true }), 'stats')).resolves.toBeNull();
    expect(libraryScope.visibleIds).not.toHaveBeenCalled();
  });

  it('lists every visible library except the hidden ones, even for a user who sees all libraries', async () => {
    const libraryScope = scope([1, 2, 3], null);

    await expect(visibleIdsOrAllForPlace(libraryScope, { ...userHiding({ stats: [2] }), isSuperuser: true }, 'stats')).resolves.toEqual([1, 3]);
  });

  it('lets an explicit library filter reach a hidden library', async () => {
    const libraryScope = scope([1, 2, 3], [1, 2, 3]);

    await expect(visibleIdsOrAllForPlace(libraryScope, userHiding({ stats: [2] }), 'stats', [2])).resolves.toEqual([1, 2, 3]);
    expect(libraryScope.visibleIds).not.toHaveBeenCalled();
  });

  it('answers no libraries when every visible library is hidden', async () => {
    const libraryScope = scope([4], [4]);

    await expect(visibleIdsOrAllForPlace(libraryScope, userHiding({ stats: [4] }), 'stats', [])).resolves.toEqual([]);
  });
});
