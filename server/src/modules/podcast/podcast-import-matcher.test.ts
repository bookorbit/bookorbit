import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';

import {
  buildEpisodeIndex,
  buildShowIndex,
  enclosureFileNameOf,
  matchEpisode,
  normalizeTitle,
  resolveShowScope,
  type EpisodeMatchInput,
  type ImportEpisodeRow,
} from './podcast-import-matcher';
import type { PodcastFileTags } from './podcast-tag-reader.service';
import { parsePodcastFileNameHints } from './podcast-tag-reader.service';

const identityHash = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex');

function episode(overrides: Partial<ImportEpisodeRow> = {}): ImportEpisodeRow {
  const guid = overrides.identityHash ?? identityHash('guid-1');
  return {
    episodeId: 101,
    podcastId: 7,
    podcastTitle: 'Orbit Radio',
    identityHash: guid,
    title: 'Landing on the Moon',
    publishedAt: new Date('2026-03-04T09:00:00.000Z'),
    durationSeconds: 1800,
    enclosureUrl: 'https://cdn.example/orbit/landing-on-the-moon.mp3?token=abc',
    mediaStatus: 'remote',
    checksum: null,
    localSizeBytes: null,
    ...overrides,
  };
}

function tags(overrides: Partial<PodcastFileTags> = {}): PodcastFileTags {
  return {
    episodeGuid: null,
    feedUrl: null,
    title: null,
    album: null,
    artist: null,
    description: null,
    publishedAt: null,
    durationSeconds: null,
    podcastFlag: false,
    ...overrides,
  };
}

function match(fileName: string, input: Partial<EpisodeMatchInput> & { episodes?: ImportEpisodeRow[] } = {}) {
  const episodes = input.episodes ?? [episode()];
  const fileTags = input.tags === undefined ? null : input.tags;
  return matchEpisode({
    fileName,
    tags: fileTags,
    hints: parsePodcastFileNameHints(fileName),
    scopedIndexes: input.scopedIndexes ?? [buildEpisodeIndex(7, episodes)],
    guidIdentityHash: fileTags?.episodeGuid ? identityHash(fileTags.episodeGuid) : null,
    guidEpisode: input.guidEpisode ?? null,
    suffixEpisode: input.suffixEpisode ?? null,
    scopedPodcastIds: input.scopedPodcastIds ?? [7],
  });
}

describe('podcast import matcher - episode cascade', () => {
  it('adopts on an Apple episode GUID alone', () => {
    const result = match('whatever.mp3', { tags: tags({ episodeGuid: 'guid-1' }) });

    expect(result).toMatchObject({ kind: 'matched', tier: 'exact', signals: ['episode_guid'] });
  });

  it('adopts on a matching enclosure file name even when nothing is tagged', () => {
    const result = match('landing-on-the-moon.mp3');

    expect(result).toMatchObject({ kind: 'matched', tier: 'exact', signals: ['enclosure_file_name'] });
  });

  it('percent-decodes and strips the query before comparing the enclosure file name', () => {
    expect(enclosureFileNameOf('https://cdn.example/a/Hello%20World.mp3?x=1#f')).toBe('hello world.mp3');
    expect(enclosureFileNameOf('not a url')).toBeNull();
  });

  it("trusts BookOrbit's own [episodeId] suffix once the show is already resolved", () => {
    const target = episode({ episodeId: 555, enclosureUrl: null, title: 'Something else entirely' });

    const result = match('2026-03-04 - Landing on the Moon [555].mp3', { episodes: [target], suffixEpisode: target });

    expect(result).toMatchObject({ kind: 'matched', tier: 'exact' });
    expect((result as { signals: string[] }).signals).toContain('episode_id_suffix');
  });

  it('ignores an [episodeId] suffix when no show was resolved, because the id space may have changed', () => {
    const stranger = episode({ episodeId: 555, podcastId: 9, enclosureUrl: null, title: 'Unrelated' });

    const result = matchEpisode({
      fileName: 'Unrelated [555].mp3',
      tags: null,
      hints: parsePodcastFileNameHints('Unrelated [555].mp3'),
      scopedIndexes: [],
      guidIdentityHash: null,
      guidEpisode: null,
      suffixEpisode: stranger,
      scopedPodcastIds: [],
    });

    expect(result).toEqual({ kind: 'none' });
  });

  it('adopts a fuzzy match only when the date and the duration both agree', () => {
    const result = match('2026-03-04 - Landing on the Moon.mp3', {
      episodes: [episode({ enclosureUrl: null })],
      tags: tags({ durationSeconds: 1810 }),
    });

    expect(result).toMatchObject({ kind: 'matched', tier: 'fuzzy', signals: ['title_and_date', 'title_and_duration'] });
  });

  it('tolerates a small title difference and a day of date drift', () => {
    const result = match('2026-03-05 - Landing on the Moonn.mp3', {
      episodes: [episode({ enclosureUrl: null })],
      tags: tags({ durationSeconds: 1830 }),
    });

    expect(result).toMatchObject({ kind: 'matched', tier: 'fuzzy' });
  });

  it('sends a single fuzzy signal to review rather than adopting it', () => {
    const result = match('2026-03-04 - Landing on the Moon.mp3', { episodes: [episode({ enclosureUrl: null, durationSeconds: null })] });

    expect(result).toMatchObject({ kind: 'ambiguous', reason: 'single_fuzzy_signal' });
    expect((result as { candidates: unknown[] }).candidates).toHaveLength(1);
  });

  it('sends competing episodes to review with at most three candidates', () => {
    const episodes = [201, 202, 203, 204].map((episodeId) =>
      episode({ episodeId, identityHash: identityHash(`guid-${episodeId}`), enclosureUrl: null }),
    );

    const result = match('2026-03-04 - Landing on the Moon.mp3', { episodes, tags: tags({ durationSeconds: 1800 }) });

    expect(result).toMatchObject({ kind: 'ambiguous', reason: 'multiple_candidates' });
    expect((result as { candidates: unknown[] }).candidates).toHaveLength(3);
  });

  it('reports nothing when neither the title, the date, nor the duration line up', () => {
    const result = match('2019-01-01 - A completely different show.mp3', {
      episodes: [episode({ enclosureUrl: null })],
      tags: tags({ durationSeconds: 60 }),
    });

    expect(result).toEqual({ kind: 'none' });
  });

  it('never matches an episode outside the resolved show', () => {
    const other = episode({ episodeId: 900, podcastId: 42 });

    const result = matchEpisode({
      fileName: 'landing-on-the-moon.mp3',
      tags: tags({ episodeGuid: 'guid-1' }),
      hints: parsePodcastFileNameHints('landing-on-the-moon.mp3'),
      scopedIndexes: [buildEpisodeIndex(42, [other])],
      guidIdentityHash: identityHash('guid-1'),
      guidEpisode: other,
      suffixEpisode: null,
      scopedPodcastIds: [7],
    });

    expect(result).toEqual({ kind: 'none' });
  });

  it('rejects a duration outside the larger of five seconds and two percent', () => {
    const near = match('Landing on the Moon.mp3', {
      episodes: [episode({ enclosureUrl: null, publishedAt: null })],
      tags: tags({ durationSeconds: 1835 }),
    });
    const far = match('Landing on the Moon.mp3', {
      episodes: [episode({ enclosureUrl: null, publishedAt: null })],
      tags: tags({ durationSeconds: 1900 }),
    });

    expect(near).toMatchObject({ kind: 'ambiguous', reason: 'single_fuzzy_signal' });
    expect(far).toEqual({ kind: 'none' });
  });
});

describe('podcast import matcher - show scope', () => {
  const shows = [
    { id: 7, title: 'Orbit Radio', feedUrlHash: 'hash-orbit' },
    { id: 8, title: 'Deep Field', feedUrlHash: 'hash-deep' },
  ];
  const index = buildShowIndex(shows, [{ podcastId: 8, urlHash: 'hash-deep-alias' }]);

  const baseInput = {
    requestedPodcastId: null,
    folderPodcastId: null,
    folderTitle: null,
    feedUrlHashFromTag: null,
    feedUrlHashFromSidecar: null,
    albumTag: null,
  };

  it('prefers the show the caller pinned', () => {
    expect(resolveShowScope(index, { ...baseInput, requestedPodcastId: 8, folderPodcastId: 7, folderTitle: 'Orbit Radio' })).toEqual({
      scope: 'request',
      podcastIds: [8],
    });
  });

  it('honours a folder id suffix only when the folder title still names that show', () => {
    expect(resolveShowScope(index, { ...baseInput, folderPodcastId: 7, folderTitle: 'Orbit Radio' })).toEqual({
      scope: 'folder_suffix',
      podcastIds: [7],
    });
    expect(resolveShowScope(index, { ...baseInput, folderPodcastId: 7, folderTitle: 'Some Other Show' })).toEqual({
      scope: 'library',
      podcastIds: [],
    });
  });

  it('resolves a feed URL tag through the alias table', () => {
    expect(resolveShowScope(index, { ...baseInput, feedUrlHashFromTag: 'hash-deep-alias' })).toEqual({
      scope: 'feed_url_tag',
      podcastIds: [8],
    });
  });

  it('falls back to a saved feed sidecar before guessing from a title', () => {
    expect(resolveShowScope(index, { ...baseInput, feedUrlHashFromSidecar: 'hash-orbit', albumTag: 'Deep Field' })).toEqual({
      scope: 'feed_sidecar',
      podcastIds: [7],
    });
  });

  it('narrows to similar show titles as a weak scope rather than a decision', () => {
    expect(resolveShowScope(index, { ...baseInput, albumTag: 'Orbit Radio!' })).toEqual({
      scope: 'title_similarity',
      podcastIds: [7],
    });
    expect(resolveShowScope(index, { ...baseInput, albumTag: 'Nothing like it' })).toEqual({ scope: 'library', podcastIds: [] });
  });
});

describe('podcast import matcher - title normalisation', () => {
  it('folds case, accents, and punctuation without erasing non-Latin scripts', () => {
    expect(normalizeTitle('Épisode #12: "Réveil"')).toBe('episode 12 reveil');
    expect(normalizeTitle('Полёт: часть 1')).toBe('полет часть 1');
    expect(normalizeTitle('宇宙飛行')).toBe('宇宙飛行');
  });
});
