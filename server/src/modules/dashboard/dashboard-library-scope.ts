import { SCROLLER_TYPE, type DashboardConfig, type ScrollerType } from '@bookorbit/types';

import { withoutHiddenLibraries } from '../../common/library-visibility/library-visibility';
import type { RequestUser } from '../../common/types/request-user';

/** Shelves about the user's own reading, which a library hidden from reading shelves stays off. */
const READING_SHELF_TYPES: ReadonlySet<ScrollerType> = new Set<ScrollerType>([
  SCROLLER_TYPE.CONTINUE_READING,
  SCROLLER_TYPE.CONTINUE_LISTENING,
  SCROLLER_TYPE.UP_NEXT_IN_SERIES,
  SCROLLER_TYPE.RANDOM,
]);

function selectedDashboardLibraryIds(user: RequestUser): number[] | undefined {
  const config = user.settings?.['dashboardConfig'];
  if (!config || typeof config !== 'object' || Array.isArray(config)) return undefined;

  const libraryIds = (config as DashboardConfig).libraryIds;
  if (!Array.isArray(libraryIds) || libraryIds.length === 0) return undefined;

  const selectedIds = [...new Set(libraryIds.filter((id) => Number.isSafeInteger(id) && id > 0))];
  return selectedIds.length > 0 ? selectedIds : undefined;
}

export function resolveDashboardLibraryIds(accessibleLibraryIds: readonly number[], user: RequestUser): number[] {
  const selectedIds = selectedDashboardLibraryIds(user);
  if (!selectedIds) return [...accessibleLibraryIds];

  const selected = new Set(selectedIds);
  return accessibleLibraryIds.filter((id) => selected.has(id));
}

export function scrollerLibraryIds(type: ScrollerType, libraryIds: readonly number[], user: RequestUser): number[] {
  return READING_SHELF_TYPES.has(type) ? withoutHiddenLibraries(libraryIds, user, 'shelves') : [...libraryIds];
}

export function dashboardLibraryScopeCacheKey(libraryIds: readonly number[]): string {
  return libraryIds.length > 0 ? [...libraryIds].sort((a, b) => a - b).join(',') : 'none';
}
