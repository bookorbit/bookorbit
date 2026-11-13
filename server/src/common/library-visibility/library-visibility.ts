import type { LibraryVisibilityPlace } from '@bookorbit/types';

import type { LibraryScopeService, LibraryScopeSubject } from '../library-scope/library-scope.service';

type SettingsSource = { settings?: Record<string, unknown> | null } | null | undefined;

/**
 * Libraries the user hid from `place`. Read defensively: settings are free-form JSON any client
 * can write, so anything that is not a list of positive ids reads as nothing hidden.
 */
export function hiddenLibraryIds(user: SettingsSource, place: LibraryVisibilityPlace): number[] {
  const visibility = user?.settings?.['libraryVisibility'];
  if (!visibility || typeof visibility !== 'object' || Array.isArray(visibility)) return [];

  const hidden = (visibility as { hidden?: unknown }).hidden;
  if (!hidden || typeof hidden !== 'object' || Array.isArray(hidden)) return [];

  const ids = (hidden as Record<string, unknown>)[place];
  if (!Array.isArray(ids)) return [];
  return [...new Set(ids.filter((id): id is number => Number.isSafeInteger(id) && id > 0))].sort((a, b) => a - b);
}

export function withoutHiddenLibraries(libraryIds: readonly number[], user: SettingsSource, place: LibraryVisibilityPlace): number[] {
  const hidden = hiddenLibraryIds(user, place);
  if (hidden.length === 0) return [...libraryIds];
  const hiddenSet = new Set(hidden);
  return libraryIds.filter((id) => !hiddenSet.has(id));
}

/** Cache-key fragment for answers that depend on what the user hid from `place`. */
export function hiddenLibrariesCacheKey(user: SettingsSource, place: LibraryVisibilityPlace): string {
  return hiddenLibraryIds(user, place).join(',');
}

/**
 * `visibleIdsOrAll` for a place the user can hide libraries from. Hiding only narrows "all
 * libraries": when the caller asked for specific libraries, a hidden one it picked still counts.
 */
export async function visibleIdsOrAllForPlace(
  libraryScope: Pick<LibraryScopeService, 'visibleIds' | 'visibleIdsOrAll'>,
  user: LibraryScopeSubject & SettingsSource,
  place: LibraryVisibilityPlace,
  requestedLibraryIds?: readonly number[] | null,
): Promise<number[] | null> {
  if (requestedLibraryIds?.length || hiddenLibraryIds(user, place).length === 0) return libraryScope.visibleIdsOrAll(user);
  return withoutHiddenLibraries(await libraryScope.visibleIds(user), user, place);
}
