import { describe, expect, it } from 'vitest';

import { MIGRATED_PLAYLIST_ICON, planPlaylistMigration } from './podcast-playlist-migration';

function playlist(overrides: Record<string, unknown> = {}) {
  return {
    id: 'podcast_playlist_abc',
    name: 'Short commutes',
    libraryId: 4,
    rules: {
      filter: 'unplayed',
      sort: 'shortest',
      maxDurationMinutes: 30,
      minDurationMinutes: null,
      publishedWithinDays: null,
      podcastIds: [],
      followedOnly: false,
    },
    ...overrides,
  };
}

describe('planPlaylistMigration', () => {
  it('returns nothing for an absent or malformed blob', () => {
    expect(planPlaylistMigration(undefined).scopes).toEqual([]);
    expect(planPlaylistMigration(null).scopes).toEqual([]);
    expect(planPlaylistMigration({ playlists: 'nope' }).scopes).toEqual([]);
  });

  it('converts a saved playlist into a podcast scope, giving it the icon scopes require', () => {
    const { scopes, skipped } = planPlaylistMigration({ playlists: [playlist()] });

    expect(skipped).toEqual([]);
    expect(scopes).toEqual([
      {
        libraryId: 4,
        name: 'Short commutes',
        icon: MIGRATED_PLAYLIST_ICON,
        filter: expect.objectContaining({ filter: 'unplayed', sort: 'shortest', maxDurationMinutes: 30 }),
      },
    ]);
  });

  it('migrates a pinned playlist, which the preferences schema would have discarded', () => {
    const { scopes } = planPlaylistMigration({ playlists: [playlist({ rules: { filter: 'pinned', sort: 'newest' } })] });

    expect(scopes).toHaveLength(1);
    expect(scopes[0].filter.filter).toBe('pinned');
  });

  it('skips the client-side built-ins so a user does not end up with duplicates', () => {
    const builtIns = ['quick', 'continue', 'downloaded', 'fresh'].map((id) => playlist({ id, name: id }));

    expect(planPlaylistMigration({ playlists: builtIns }).scopes).toEqual([]);
  });

  it('reports what it could not convert instead of dropping it silently', () => {
    const { scopes, skipped } = planPlaylistMigration({
      playlists: [
        playlist({ name: '  ' }),
        playlist({ libraryId: 0 }),
        playlist({ name: 'Bad rules', rules: { filter: 'archived' } }),
        playlist({ name: 'Keeper' }),
      ],
    });

    expect(scopes.map((scope) => scope.name)).toEqual(['Keeper']);
    expect(skipped).toEqual([
      { name: '(unnamed)', reason: 'missing name' },
      { name: 'Short commutes', reason: 'missing or invalid libraryId' },
      { name: 'Bad rules', reason: expect.stringContaining('archived') },
    ]);
  });

  it('disambiguates names that collide within the blob', () => {
    const { scopes } = planPlaylistMigration({ playlists: [playlist({ name: 'Fresh' }), playlist({ name: 'Fresh' })] });

    expect(scopes.map((scope) => scope.name)).toEqual(['Fresh', 'Fresh (2)']);
  });

  it('re-running skips what a previous run already migrated instead of duplicating it', () => {
    const { scopes, skipped } = planPlaylistMigration({ playlists: [playlist({ name: 'Fresh' })] }, ['Fresh']);

    expect(scopes).toEqual([]);
    expect(skipped).toEqual([{ name: 'Fresh', reason: 'already migrated' }]);
  });

  it('still migrates a playlist whose name differs from an existing scope', () => {
    const { scopes } = planPlaylistMigration({ playlists: [playlist({ name: 'Newer' })] }, ['Fresh']);

    expect(scopes.map((scope) => scope.name)).toEqual(['Newer']);
  });

  it('keeps a generated name within the column limit', () => {
    const longName = 'x'.repeat(300);
    const { scopes } = planPlaylistMigration({ playlists: [playlist({ name: longName }), playlist({ name: longName })] });

    expect(scopes[0].name).toHaveLength(255);
    expect(scopes[1].name).toHaveLength(255);
    expect(scopes[1].name.endsWith(' (2)')).toBe(true);
  });
});
