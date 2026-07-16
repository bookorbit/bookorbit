import { MetadataProviderKey } from '@bookorbit/types';

import { mapLibroFmAudiobook } from './librofm.mapper';
import type { LibroFmAudiobook } from './librofm.types';

function makeAudiobook(overrides: Partial<LibroFmAudiobook> = {}): LibroFmAudiobook {
  return {
    title: 'And Then She Vanished',
    isbn: 9781982689711,
    ...overrides,
  };
}

describe('mapLibroFmAudiobook', () => {
  it('maps every compatible audiobook metadata field', () => {
    const result = mapLibroFmAudiobook(
      makeAudiobook({
        subtitle: 'The Joseph Bridgeman Series, Book 1',
        authors: [' Nick Jones '],
        description: '<p>He only looked away for <strong>a second</strong>.</p>',
        publisher: 'Blackstone Publishing',
        publication_date: '2021-04-03T00:00:00.000Z',
        audiobook_info: {
          narrators: [' Ray Porter '],
          duration: 32821,
          audio_language: 'eng',
          audio_language_display: 'English',
        },
        abridged: false,
        series: 'The Joseph Bridgeman Series',
        series_num: 1,
        genres: [{ name: 'Fiction' }, { name: 'Mystery & Thriller' }, { name: 'Science Fiction' }],
        cover_url: '//covers.libro.fm/9781982689711_1120.jpg',
      }),
    );

    expect(result).toEqual({
      provider: MetadataProviderKey.LIBROFM,
      providerId: '9781982689711',
      title: 'And Then She Vanished',
      subtitle: 'The Joseph Bridgeman Series, Book 1',
      authors: ['Nick Jones'],
      narrators: ['Ray Porter'],
      description: 'He only looked away for a second.',
      publisher: 'Blackstone Publishing',
      publishedDate: '2021-04-03',
      publishedYear: 2021,
      language: 'English',
      isbn13: '9781982689711',
      seriesName: 'The Joseph Bridgeman Series',
      seriesIndex: 1,
      seriesMemberships: [{ seriesName: 'The Joseph Bridgeman Series', seriesIndex: 1 }],
      genres: ['Fiction', 'Mystery & Thriller', 'Science Fiction'],
      coverUrl: 'https://covers.libro.fm/9781982689711_1120.jpg',
      sourceUrl: 'https://libro.fm/audiobooks/9781982689711',
      durationSeconds: 32821,
      abridged: false,
    });
  });

  it('falls back to the language code and omits invalid optional values', () => {
    const result = mapLibroFmAudiobook(
      makeAudiobook({
        audiobook_info: { duration: -1, audio_language: 'eng' },
        series: ' ',
        series_num: 'unknown',
        genres: [{ name: 'Fiction' }, { name: 'fiction' }, { name: ' ' }],
      }),
    );

    expect(result.language).toBe('eng');
    expect(result.durationSeconds).toBeUndefined();
    expect(result.seriesMemberships).toBeUndefined();
    expect(result.genres).toEqual(['Fiction']);
  });

  it('rejects responses without an ISBN or title', () => {
    expect(() => mapLibroFmAudiobook(makeAudiobook({ isbn: null }))).toThrow('missing ISBN');
    expect(() => mapLibroFmAudiobook(makeAudiobook({ title: null }))).toThrow('missing title');
  });
});
