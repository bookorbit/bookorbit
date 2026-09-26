// Nest pulls this in during bootstrap; a DTO imported on its own needs it before `@Type` can read a design type.
import 'reflect-metadata';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { describe, expect, it } from 'vitest';

import {
  PODCAST_EPISODE_MAX_CHAPTERS,
  PODCAST_EPISODE_MAX_DURATION_SECONDS,
  PODCAST_PLAYLIST_MAX_SHOWS,
  PODCAST_PLAYLIST_QUEUE_LIMIT,
} from '@bookorbit/types';

import {
  assertPodcastCreateSource,
  CreatePodcastBookmarkDto,
  CreatePodcastDto,
  ListPodcastEpisodesDto,
  ListPodcastQueueDto,
  MovePodcastQueueDto,
  PodcastOpmlImportDto,
  QueuePodcastEpisodeDto,
  QueuePodcastEpisodesDto,
  UpdateEpisodeStateDto,
  UpdatePodcastBookmarkDto,
  UpdatePodcastConfigDto,
  UpdatePodcastEpisodeMetadataDto,
  UpdatePodcastLibrarySettingsDto,
  UpdatePodcastMetadataDto,
  UploadPodcastArtworkFromUrlDto,
} from './podcast.dto';

describe('podcast DTO null validation', () => {
  it.each([
    { Dto: CreatePodcastDto, payload: { feedUrl: 'https://example.com/feed.xml', acquisitionPolicy: null }, property: 'acquisitionPolicy' },
    { Dto: CreatePodcastDto, payload: { feedUrl: 'https://example.com/feed.xml', autoDownloadLimit: null }, property: 'autoDownloadLimit' },
    { Dto: CreatePodcastDto, payload: { feedUrl: 'https://example.com/feed.xml', autoDownloadWindowDays: null }, property: 'autoDownloadWindowDays' },
    { Dto: CreatePodcastDto, payload: { feedUrl: 'https://example.com/feed.xml', refreshIntervalMinutes: null }, property: 'refreshIntervalMinutes' },
    { Dto: UpdatePodcastMetadataDto, payload: { title: null }, property: 'title' },
    { Dto: UpdatePodcastMetadataDto, payload: { lockedFields: null }, property: 'lockedFields' },
    { Dto: UpdatePodcastConfigDto, payload: { acquisitionPolicy: null }, property: 'acquisitionPolicy' },
    { Dto: UpdatePodcastConfigDto, payload: { refreshIntervalMinutes: null }, property: 'refreshIntervalMinutes' },
    { Dto: UpdatePodcastLibrarySettingsDto, payload: { storageQuotaBytes: null }, property: 'storageQuotaBytes' },
    { Dto: UpdatePodcastLibrarySettingsDto, payload: { minimumFreeSpaceBytes: null }, property: 'minimumFreeSpaceBytes' },
    { Dto: UpdatePodcastLibrarySettingsDto, payload: { defaultRefreshIntervalMinutes: null }, property: 'defaultRefreshIntervalMinutes' },
    { Dto: UpdatePodcastLibrarySettingsDto, payload: { completionRemainingSeconds: null }, property: 'completionRemainingSeconds' },
    { Dto: UpdateEpisodeStateDto, payload: { positionSeconds: null }, property: 'positionSeconds' },
    { Dto: UpdateEpisodeStateDto, payload: { progressPercent: null }, property: 'progressPercent' },
    { Dto: UpdateEpisodeStateDto, payload: { finished: null }, property: 'finished' },
    { Dto: UpdateEpisodeStateDto, payload: { pinned: null }, property: 'pinned' },
    { Dto: QueuePodcastEpisodeDto, payload: { afterEpisodeId: null }, property: 'afterEpisodeId' },
    { Dto: CreatePodcastBookmarkDto, payload: { positionSeconds: 0, title: 'Start', note: null }, property: 'note' },
    { Dto: UpdatePodcastBookmarkDto, payload: { title: null }, property: 'title' },
    { Dto: PodcastOpmlImportDto, payload: { opml: '<opml />', acquisitionPolicy: null }, property: 'acquisitionPolicy' },
    { Dto: PodcastOpmlImportDto, payload: { opml: '<opml />', autoDownloadLimit: null }, property: 'autoDownloadLimit' },
    { Dto: PodcastOpmlImportDto, payload: { opml: '<opml />', autoDownloadWindowDays: null }, property: 'autoDownloadWindowDays' },
  ])('rejects null for $property', async ({ Dto, payload, property }) => {
    const errors = await validate(plainToInstance(Dto, payload));

    expect(errors.some((error) => error.property === property)).toBe(true);
  });

  it('allows null only for fields whose contracts use null to clear a value', async () => {
    const metadataErrors = await validate(
      plainToInstance(UpdatePodcastMetadataDto, { author: null, description: null, siteUrl: null, language: null }),
    );
    const configErrors = await validate(plainToInstance(UpdatePodcastConfigDto, { autoDownloadLimit: null, autoDownloadWindowDays: null }));
    const bookmarkErrors = await validate(plainToInstance(UpdatePodcastBookmarkDto, { note: null }));

    expect(metadataErrors).toEqual([]);
    expect(configErrors).toEqual([]);
    expect(bookmarkErrors).toEqual([]);
  });
});

describe('acquisition policy DTOs', () => {
  it.each([
    { Dto: CreatePodcastDto, payload: { source: 'feed', feedUrl: 'https://example.com/feed.xml', acquisitionPolicy: 'manual' } },
    { Dto: UpdatePodcastConfigDto, payload: { acquisitionPolicy: 'manual' } },
    { Dto: PodcastOpmlImportDto, payload: { opml: '<opml />', acquisitionPolicy: 'manual' } },
  ])('accepts the manual policy without acquisition bounds', async ({ Dto, payload }) => {
    const errors = await validate(plainToInstance(Dto, payload));

    expect(errors).toEqual([]);
  });

  it('still rejects an unknown policy', async () => {
    const errors = await validate(plainToInstance(UpdatePodcastConfigDto, { acquisitionPolicy: 'everything' }));

    expect(errors.some((error) => error.property === 'acquisitionPolicy')).toBe(true);
  });
});

describe('CreatePodcastDto source discriminator', () => {
  it('validates only the arm the source names', async () => {
    const feed = plainToInstance(CreatePodcastDto, { source: 'feed', feedUrl: 'https://example.com/feed.xml' });
    const folder = plainToInstance(CreatePodcastDto, { source: 'folder', folderPath: 'Field Recordings' });

    expect(await validate(feed)).toEqual([]);
    expect(await validate(folder)).toEqual([]);
  });

  it('requires the field its own arm depends on', async () => {
    const feed = await validate(plainToInstance(CreatePodcastDto, { source: 'feed' }));
    const folder = await validate(plainToInstance(CreatePodcastDto, { source: 'folder' }));

    expect(feed.some((error) => error.property === 'feedUrl')).toBe(true);
    expect(folder.some((error) => error.property === 'folderPath')).toBe(true);
  });

  it('rejects an unknown or missing source', async () => {
    const unknown = await validate(plainToInstance(CreatePodcastDto, { source: 'magnet', feedUrl: 'https://example.com/feed.xml' }));
    const missing = await validate(plainToInstance(CreatePodcastDto, { feedUrl: 'https://example.com/feed.xml' }));

    expect(unknown.some((error) => error.property === 'source')).toBe(true);
    expect(missing.some((error) => error.property === 'source')).toBe(true);
  });

  /**
   * A skipped `ValidateIf` leaves the value in place rather than rejecting it, so the cross-arm
   * check is the only thing standing between a folder request and a silently stored feed setting.
   */
  it('refuses fields belonging to the other arm', () => {
    const folderWithFeedFields = plainToInstance(CreatePodcastDto, {
      source: 'folder',
      folderPath: 'Field Recordings',
      refreshIntervalMinutes: 60,
    });
    const feedWithFolderPath = plainToInstance(CreatePodcastDto, {
      source: 'feed',
      feedUrl: 'https://example.com/feed.xml',
      folderPath: 'Field Recordings',
    });

    expect(() => assertPodcastCreateSource(folderWithFeedFields)).toThrow(BadRequestException);
    expect(() => assertPodcastCreateSource(feedWithFolderPath)).toThrow(BadRequestException);
    expect(() => assertPodcastCreateSource(plainToInstance(CreatePodcastDto, { source: 'folder', folderPath: 'Field Recordings' }))).not.toThrow();
  });
});

describe('podcast episode rule DTOs', () => {
  it('parses playlist rules from query strings, including a comma separated show list', async () => {
    const dto = plainToInstance(ListPodcastEpisodesDto, {
      filter: 'unplayed',
      sort: 'shortest',
      maxDurationMinutes: '20',
      publishedWithinDays: '7',
      podcastIds: '4,9',
      followedOnly: 'true',
      page: '2',
      size: '50',
    });

    expect(await validate(dto)).toEqual([]);
    expect(dto).toMatchObject({
      filter: 'unplayed',
      sort: 'shortest',
      maxDurationMinutes: 20,
      publishedWithinDays: 7,
      podcastIds: [4, 9],
      followedOnly: true,
      page: 2,
      size: 50,
    });
  });

  it('rejects durations and show lists outside their bounds', async () => {
    const durationErrors = await validate(plainToInstance(ListPodcastEpisodesDto, { maxDurationMinutes: '1441' }));
    const showErrors = await validate(
      plainToInstance(ListPodcastEpisodesDto, { podcastIds: Array.from({ length: PODCAST_PLAYLIST_MAX_SHOWS + 1 }, (_, index) => index + 1) }),
    );

    expect(durationErrors.some((error) => error.property === 'maxDurationMinutes')).toBe(true);
    expect(showErrors.some((error) => error.property === 'podcastIds')).toBe(true);
  });

  it('caps the bulk queue limit and defaults to the playlist ceiling', async () => {
    const defaults = plainToInstance(QueuePodcastEpisodesDto, { filter: 'downloaded' });
    const errors = await validate(plainToInstance(QueuePodcastEpisodesDto, { limit: PODCAST_PLAYLIST_QUEUE_LIMIT + 1 }));

    expect(await validate(defaults)).toEqual([]);
    expect(defaults.limit).toBe(PODCAST_PLAYLIST_QUEUE_LIMIT);
    expect(errors.some((error) => error.property === 'limit')).toBe(true);
  });

  it('accepts pinned as a shared list and queue rule', async () => {
    const list = plainToInstance(ListPodcastEpisodesDto, { filter: 'pinned' });
    const queue = plainToInstance(QueuePodcastEpisodesDto, { filter: 'pinned' });

    expect(await validate(list)).toEqual([]);
    expect(await validate(queue)).toEqual([]);
    expect(list.filter).toBe('pinned');
    expect(queue.filter).toBe('pinned');
  });
});

describe('ListPodcastQueueDto search', () => {
  it('accepts a search term and keeps the paging defaults', async () => {
    const dto = plainToInstance(ListPodcastQueueDto, { q: 'orbit' });

    expect(await validate(dto)).toEqual([]);
    expect(dto).toMatchObject({ q: 'orbit', page: 0, size: 50 });
  });

  it('rejects a search term beyond the length cap', async () => {
    const errors = await validate(plainToInstance(ListPodcastQueueDto, { q: 'a'.repeat(501) }));

    expect(errors.some((error) => error.property === 'q')).toBe(true);
  });
});

describe('MovePodcastQueueDto', () => {
  it('accepts a zero-based target index', async () => {
    const dto = plainToInstance(MovePodcastQueueDto, { episodeId: 11, position: 0 });

    expect(await validate(dto)).toEqual([]);
  });

  it.each([
    { payload: { episodeId: 11, position: -1 }, property: 'position' },
    { payload: { episodeId: 11, position: 1000 }, property: 'position' },
    { payload: { episodeId: 11, position: 1.5 }, property: 'position' },
    { payload: { episodeId: 0, position: 0 }, property: 'episodeId' },
    { payload: { position: 0 }, property: 'episodeId' },
    { payload: { episodeId: 11 }, property: 'position' },
  ])('rejects $payload', async ({ payload, property }) => {
    const errors = await validate(plainToInstance(MovePodcastQueueDto, payload));

    expect(errors.some((error) => error.property === property)).toBe(true);
  });
});

describe('podcast show metadata DTO', () => {
  it('accepts the full editable field set', async () => {
    const errors = await validate(
      plainToInstance(UpdatePodcastMetadataDto, {
        title: 'Orbit Radio',
        author: 'Orbit Media',
        description: '<p>About the show</p>',
        siteUrl: 'https://orbit.example/show',
        language: 'en-us',
        explicit: true,
        categories: ['News', 'Technology'],
        lockedFields: ['title', 'categories'],
      }),
    );

    expect(errors).toEqual([]);
  });

  it.each([
    { payload: { siteUrl: 'javascript:alert(1)' }, property: 'siteUrl' },
    { payload: { siteUrl: 'https://user:secret@orbit.example' }, property: 'siteUrl' },
    { payload: { categories: [{ name: 'News' }] }, property: 'categories' },
    { payload: { categories: Array.from({ length: 101 }, (_, index) => `Category ${index}`) }, property: 'categories' },
    { payload: { explicit: 'yes' }, property: 'explicit' },
    { payload: { lockedFields: ['artwork'] }, property: 'lockedFields' },
  ])('rejects $property when it is outside the contract', async ({ payload, property }) => {
    const errors = await validate(plainToInstance(UpdatePodcastMetadataDto, payload));

    expect(errors.some((error) => error.property === property)).toBe(true);
  });

  it('rejects artwork URLs that are not plain http or https', async () => {
    const errors = await validate(plainToInstance(UploadPodcastArtworkFromUrlDto, { url: 'file:///etc/passwd' }));

    expect(errors.some((error) => error.property === 'url')).toBe(true);
  });

  it('accepts an http artwork URL', async () => {
    const errors = await validate(plainToInstance(UploadPodcastArtworkFromUrlDto, { url: 'https://cdn.example/artwork.png' }));

    expect(errors).toEqual([]);
  });
});

describe('podcast episode metadata DTO', () => {
  it('accepts the full editable field set', async () => {
    const errors = await validate(
      plainToInstance(UpdatePodcastEpisodeMetadataDto, {
        title: 'Orbital mechanics',
        subtitle: 'Part one',
        description: '<p>About the episode</p>',
        publishedAt: '2026-07-29T10:00:00.000Z',
        season: '2',
        episode: '14',
        episodeType: 'full',
        durationSeconds: 3600,
        explicit: true,
        chapters: [{ title: 'Intro', startSeconds: 0 }],
        lockedFields: ['title', 'durationSeconds'],
      }),
    );

    expect(errors).toEqual([]);
  });

  it('accepts null for every field whose contract uses null to clear a value', async () => {
    const errors = await validate(
      plainToInstance(UpdatePodcastEpisodeMetadataDto, {
        subtitle: null,
        description: null,
        publishedAt: null,
        season: null,
        episode: null,
        episodeType: null,
        durationSeconds: null,
      }),
    );

    expect(errors).toEqual([]);
  });

  it.each([
    { payload: { title: null }, property: 'title' },
    { payload: { explicit: null }, property: 'explicit' },
    { payload: { lockedFields: null }, property: 'lockedFields' },
    { payload: { episodeType: 'interview' }, property: 'episodeType' },
    { payload: { durationSeconds: 0 }, property: 'durationSeconds' },
    { payload: { durationSeconds: -1 }, property: 'durationSeconds' },
    { payload: { durationSeconds: PODCAST_EPISODE_MAX_DURATION_SECONDS + 1 }, property: 'durationSeconds' },
    { payload: { publishedAt: '29/07/2026' }, property: 'publishedAt' },
    { payload: { season: 'x'.repeat(101) }, property: 'season' },
    { payload: { lockedFields: ['guid'] }, property: 'lockedFields' },
    { payload: { lockedFields: ['transcripts'] }, property: 'lockedFields' },
    { payload: { chapters: [{ title: 'Intro' }] }, property: 'chapters' },
    { payload: { chapters: [{ title: 'Intro', startSeconds: -1 }] }, property: 'chapters' },
    { payload: { chapters: [{ title: '', startSeconds: 0 }] }, property: 'chapters' },
    { payload: { chapters: [{ title: 'Intro', startSeconds: 0, url: 'javascript:alert(1)' }] }, property: 'chapters' },
    {
      payload: {
        chapters: Array.from({ length: PODCAST_EPISODE_MAX_CHAPTERS + 1 }, (_, index) => ({ title: `Chapter ${index}`, startSeconds: index })),
      },
      property: 'chapters',
    },
  ])('rejects $property when it is outside the contract', async ({ payload, property }) => {
    const errors = await validate(plainToInstance(UpdatePodcastEpisodeMetadataDto, payload));

    expect(errors.some((error) => error.property === property)).toBe(true);
  });

  // Identity and delivery fields always take the feed value on refresh, so accepting a write for
  // them would store an edit the next refresh silently discards.
  it.each(['guid', 'enclosureUrl', 'enclosureType', 'enclosureSizeBytes', 'transcripts', 'inFeed'])(
    'refuses a write to the feed-owned field %s',
    async (field) => {
      const pipe = new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true });

      const rejection = await pipe
        .transform({ title: 'Orbital mechanics', [field]: 'anything' }, { type: 'body', metatype: UpdatePodcastEpisodeMetadataDto })
        .then(() => null)
        .catch((error: BadRequestException) => error);

      expect(rejection).toBeInstanceOf(BadRequestException);
      expect((rejection?.getResponse() as { message: string[] }).message).toContain(`property ${field} should not exist`);
    },
  );
});
