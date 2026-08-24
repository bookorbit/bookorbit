import { makeUser } from '../../common/test-utils/make-user';
import { dashboardLibraryScopeCacheKey, resolveDashboardLibraryIds } from './dashboard-library-scope';

describe('dashboard library scope', () => {
  it('uses every accessible library when no dashboard selection is stored', () => {
    expect(resolveDashboardLibraryIds([3, 1], makeUser())).toEqual([3, 1]);
  });

  it('intersects the saved selection with accessible libraries and preserves accessible order', () => {
    const user = makeUser({ settings: { dashboardConfig: { libraryIds: [9, 3, 9, 99] } } });

    expect(resolveDashboardLibraryIds([1, 3, 9, 12], user)).toEqual([3, 9]);
  });

  it('returns no libraries when every saved selection has become inaccessible', () => {
    const user = makeUser({ settings: { dashboardConfig: { libraryIds: [8] } } });

    expect(resolveDashboardLibraryIds([1, 2], user)).toEqual([]);
  });

  it.each([undefined, null, 'invalid', [], [0, -1, 1.5, Number.NaN]])(
    'treats a missing or unusable selection as all accessible libraries: %j',
    (libraryIds) => {
      const user = makeUser({ settings: { dashboardConfig: { libraryIds } } });

      expect(resolveDashboardLibraryIds([4, 5], user)).toEqual([4, 5]);
    },
  );

  it('builds a stable cache key from the resolved accessible intersection', () => {
    expect(dashboardLibraryScopeCacheKey([7, 2])).toBe('2,7');
    expect(dashboardLibraryScopeCacheKey([2, 7])).toBe('2,7');
    expect(dashboardLibraryScopeCacheKey([])).toBe('none');
  });
});
