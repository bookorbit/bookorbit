import { afterEach, describe, expect, it, vi } from 'vitest';

import { mapFfprobeOutput, parsePodcastFileNameHints, parsePodcastFolderId, PodcastTagReaderService } from './podcast-tag-reader.service';

describe('podcast tag mapping', () => {
  it('reads the Apple ID3 frame names FFmpeg passes through unchanged', () => {
    const tags = mapFfprobeOutput({
      format: {
        duration: '1802.5',
        tags: { TGID: 'guid-abc', WFED: 'https://feeds.example/orbit.xml', TDES: 'A description', PCST: '1', title: 'Landing', date: '2026-03-04' },
      },
    });

    expect(tags).toMatchObject({
      episodeGuid: 'guid-abc',
      feedUrl: 'https://feeds.example/orbit.xml',
      description: 'A description',
      title: 'Landing',
      durationSeconds: 1802.5,
      podcastFlag: true,
    });
    expect(tags.publishedAt?.toISOString()).toBe('2026-03-04T00:00:00.000Z');
  });

  it('reads the readable names the MP4 demuxer renames the same atoms to', () => {
    const tags = mapFfprobeOutput({
      format: { tags: { episode_uid: 'guid-mp4', podcast_url: 'https://feeds.example/deep.xml', synopsis: 'Long description', podcast: 'yes' } },
    });

    expect(tags).toMatchObject({
      episodeGuid: 'guid-mp4',
      feedUrl: 'https://feeds.example/deep.xml',
      description: 'Long description',
      podcastFlag: true,
    });
  });

  it('falls back to audio stream tags, which is where Ogg and Opus carry their comments', () => {
    const tags = mapFfprobeOutput({
      format: { duration: '60' },
      streams: [
        { codec_type: 'video', tags: { title: 'Cover art' } },
        { codec_type: 'audio', tags: { TITLE: 'From the stream', TGID: 'guid-ogg' } },
      ],
    });

    expect(tags).toMatchObject({ title: 'From the stream', episodeGuid: 'guid-ogg' });
  });

  it('lets a format tag win over a stream tag of the same name', () => {
    const tags = mapFfprobeOutput({
      format: { tags: { title: 'Format wins' } },
      streams: [{ codec_type: 'audio', tags: { title: 'Stream loses' } }],
    });

    expect(tags.title).toBe('Format wins');
  });

  it('strips control characters and caps a tag rather than trusting its length', () => {
    const tags = mapFfprobeOutput({ format: { tags: { title: `Line\u0000one\u001funder${'x'.repeat(4000)}` } } });

    expect(tags.title?.startsWith('Line one under')).toBe(true);
    expect(tags.title).toHaveLength(2000);
  });

  it('drops an unusable date and accepts a bare year', () => {
    expect(mapFfprobeOutput({ format: { tags: { date: 'not a date' } } }).publishedAt).toBeNull();
    expect(mapFfprobeOutput({ format: { tags: { date: '1899' } } }).publishedAt).toBeNull();
    expect(mapFfprobeOutput({ format: { tags: { date: '2026' } } }).publishedAt?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });

  it('returns an empty record for a file with no tags at all', () => {
    expect(mapFfprobeOutput({})).toMatchObject({ episodeGuid: null, feedUrl: null, title: null, durationSeconds: null, podcastFlag: false });
  });
});

/**
 * The track tag is what a numbered show writes its own ordering in, and it reaches BookOrbit in
 * several spellings. `readForImport` maps a probe result, so the mapping is exercised through a
 * stubbed probe rather than through a real ffprobe run.
 */
describe('podcast track numbers', () => {
  const reader = new PodcastTagReaderService();

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ['7', '7'],
    ['07', '7'],
    ['7/64', '7'],
    ['07 / 64', '7'],
  ])('normalises the track tag %s to %s', async (raw, expected) => {
    vi.spyOn(reader as never as { probe: () => unknown }, 'probe').mockResolvedValue({ format: { tags: { track: raw } } });

    await expect(reader.readForImport('/path/to/probe.mp3').then((probe) => probe?.trackNumber)).resolves.toBe(expected);
  });

  it.each([['0'], ['not a track'], ['1234567'], ['']])('ignores an unusable track tag %s', async (raw) => {
    vi.spyOn(reader as never as { probe: () => unknown }, 'probe').mockResolvedValue({ format: { tags: { track: raw } } });

    await expect(reader.readForImport('/path/to/probe.mp3').then((probe) => probe?.trackNumber)).resolves.toBeNull();
  });

  it('reports no track number when the file carries none', async () => {
    vi.spyOn(reader as never as { probe: () => unknown }, 'probe').mockResolvedValue({ format: { tags: {} } });

    await expect(reader.readForImport('/path/to/probe.mp3').then((probe) => probe?.trackNumber)).resolves.toBeNull();
  });
});

describe('podcast file name hints', () => {
  it("reads BookOrbit's own download name", () => {
    const hints = parsePodcastFileNameHints('2026-03-04 - Landing on the Moon [1234].mp3');

    expect(hints.episodeId).toBe(1234);
    expect(hints.title).toBe('Landing on the Moon');
    // Midday, not midnight: a filename carries a calendar date, and anchoring it at UTC midnight
    // rendered the day before everywhere west of Greenwich.
    expect(hints.publishedAt?.toISOString()).toBe('2026-03-04T12:00:00.000Z');
  });

  it('reads the plain date-and-title convention', () => {
    expect(parsePodcastFileNameHints('2026-03-04_Landing.m4a')).toMatchObject({ episodeId: null, title: 'Landing' });
    expect(parsePodcastFileNameHints('2026-03-04 Landing.m4a').title).toBe('Landing');
  });

  it('leaves a name with no date or id alone', () => {
    expect(parsePodcastFileNameHints('landing-on-the-moon.mp3')).toEqual({
      episodeId: null,
      publishedAt: null,
      title: 'landing-on-the-moon',
    });
  });

  it('rejects a date the calendar does not have', () => {
    expect(parsePodcastFileNameHints('2026-02-31 - Landing.mp3').publishedAt).toBeNull();
  });

  it('reads the show folder id suffix and ignores anything else', () => {
    expect(parsePodcastFolderId('Orbit Radio [12]')).toBe(12);
    expect(parsePodcastFolderId('Orbit Radio')).toBeNull();
    expect(parsePodcastFolderId('Orbit Radio [0]')).toBeNull();
  });
});
