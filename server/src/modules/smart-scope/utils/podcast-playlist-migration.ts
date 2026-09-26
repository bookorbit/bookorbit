import { validatePodcastScopeRules } from './podcast-scope-rules.validator';
import type { PodcastScopeRules } from '@bookorbit/types';

/** The icon a migrated playlist gets, since playlists never had one and scopes require it. */
export const MIGRATED_PLAYLIST_ICON = 'Podcast';

/** Built-ins are recreated client-side, so migrating them would duplicate every user's list. */
const BUILT_IN_PLAYLIST_IDS = new Set(['quick', 'continue', 'downloaded', 'fresh']);

const MAX_NAME_LENGTH = 255;

export interface MigratableScope {
  libraryId: number;
  name: string;
  icon: string;
  filter: PodcastScopeRules;
}

export interface PlaylistMigrationResult {
  scopes: MigratableScope[];
  /** Playlists that could not be converted, with why, so a run can report instead of silently dropping. */
  skipped: { name: string; reason: string }[];
}

function uniqueName(desired: string, taken: Set<string>): string {
  const base = desired.slice(0, MAX_NAME_LENGTH);
  if (!taken.has(base)) return base;
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const tail = ` (${suffix})`;
    const candidate = `${base.slice(0, MAX_NAME_LENGTH - tail.length)}${tail}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new Error(`Unable to find a free name for "${desired}"`);
}

/**
 * Converts one user's stored playlist blob into podcast smart scopes.
 *
 * Reads the raw jsonb rather than the sanitized preferences accessor on purpose: that accessor
 * validates the whole array against a schema whose filter enum omits `pinned`, so a single pinned
 * playlist makes it return an empty list. Migrating through it would silently discard real data.
 *
 * `existingNames` are the user's current podcast scope names. A playlist matching one of them was
 * already migrated and is reported as such, so re-running converges instead of accumulating copies.
 * Names are only disambiguated against other playlists in the same blob.
 */
export function planPlaylistMigration(rawPreference: unknown, existingNames: Iterable<string> = []): PlaylistMigrationResult {
  const scopes: MigratableScope[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const alreadyMigrated = new Set(existingNames);
  const taken = new Set(alreadyMigrated);

  const playlists = (rawPreference as { playlists?: unknown } | null | undefined)?.playlists;
  if (!Array.isArray(playlists)) return { scopes, skipped };

  for (const entry of playlists) {
    if (typeof entry !== 'object' || entry === null) {
      skipped.push({ name: '(unnamed)', reason: 'entry is not an object' });
      continue;
    }
    const playlist = entry as { id?: unknown; name?: unknown; libraryId?: unknown; rules?: unknown };

    if (typeof playlist.id === 'string' && BUILT_IN_PLAYLIST_IDS.has(playlist.id)) continue;

    const name = typeof playlist.name === 'string' ? playlist.name.trim() : '';
    if (!name) {
      skipped.push({ name: '(unnamed)', reason: 'missing name' });
      continue;
    }

    if (alreadyMigrated.has(name.slice(0, MAX_NAME_LENGTH))) {
      skipped.push({ name, reason: 'already migrated' });
      continue;
    }

    const libraryId = playlist.libraryId;
    if (typeof libraryId !== 'number' || !Number.isInteger(libraryId) || libraryId < 1) {
      skipped.push({ name, reason: 'missing or invalid libraryId' });
      continue;
    }

    let filter: PodcastScopeRules | null;
    try {
      filter = validatePodcastScopeRules(playlist.rules);
    } catch (error) {
      skipped.push({ name, reason: error instanceof Error ? error.message : 'invalid rules' });
      continue;
    }
    if (!filter) {
      skipped.push({ name, reason: 'missing rules' });
      continue;
    }

    const finalName = uniqueName(name, taken);
    taken.add(finalName);
    scopes.push({ libraryId, name: finalName, icon: MIGRATED_PLAYLIST_ICON, filter });
  }

  return { scopes, skipped };
}
