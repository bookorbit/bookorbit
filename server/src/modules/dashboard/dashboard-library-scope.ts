import type { DashboardConfig } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';

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

export function dashboardLibraryScopeCacheKey(libraryIds: readonly number[]): string {
  return libraryIds.length > 0 ? [...libraryIds].sort((a, b) => a - b).join(',') : 'none';
}
