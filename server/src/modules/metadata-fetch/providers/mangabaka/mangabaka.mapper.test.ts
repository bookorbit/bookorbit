import { MetadataProviderKey } from '@bookorbit/types';
import { describe, expect, it } from 'vitest';

import { mapMangabakaSeries, mapMangabakaWork, pickBestCollection } from './mangabaka.mapper';
import { MangabakaCollection, MangabakaSeries, MangabakaWork } from './mangabaka.types';

const baseSeries: MangabakaSeries = {
  id: 1,
  state: 'active',
  merged_with: null,
  title: 'DICE',
  native_title: '다이스',
  romanized_title: 'DICE',
  secondary_titles: null,
  cover: {
    raw: {
      url: 'https://images.mangabaka.dev/test',
      size: 100000,
      height: 800,
      width: 600,
      blurhash: 'test',
      thumbhash: 'test',
      format: 'jpeg',
    },
    x150: { x1: 'https://cdn.mangabaka.dev/x150/1', x2: 'https://cdn.mangabaka.dev/x150/2', x3: 'https://cdn.mangabaka.dev/x150/3' },
    x250: { x1: 'https://cdn.mangabaka.dev/x250/1', x2: 'https://cdn.mangabaka.dev/x250/2', x3: 'https://cdn.mangabaka.dev/x250/3' },
    x350: { x1: 'https://cdn.mangabaka.dev/x350/1', x2: 'https://cdn.mangabaka.dev/x350/2', x3: 'https://cdn.mangabaka.dev/x350/3' },
  },
  authors: ['Hyun-Seok Yun'],
  artists: ['Hyun-Seok Yun'],
  description: 'A manga about dice.',
  year: 2013,
  published: {
    start_date: '2013-05-18',
    end_date: '2021-07-17',
    start_date_is_estimated: false,
    end_date_is_estimated: false,
  },
  status: 'completed',
  is_licensed: true,
  has_anime: true,
  anime: null,
  content_rating: 'safe',
  type: 'manhwa',
  rating: 70.3,
  popularity: {
    global: { current: 794, history: {} },
    type: { current: 234, history: {} },
  },
  final_volume: null,
  total_chapters: '388',
  links: [],
  links_v2: [
    {
      id: 'test-id',
      url: 'https://mangabaka.org/1',
      name: 'mangabaka.org',
      name_display: 'MangaBaka',
      type: 'info',
      language: null,
    },
  ],
  publishers: [
    { name: 'LINE Webtoon', type: 'English', note: '' },
    { name: 'Naver', type: 'Original', note: '' },
  ],
  titles: [
    { language: 'ko', traits: ['native'], title: '다이스', note: null, is_primary: true },
    { language: 'en', traits: ['official'], title: 'Dice', note: null, is_primary: true },
  ],
  genres_v2: null,
  genres: ['action', 'drama', 'psychological'],
  tags_v2: [],
  tags: [],
  last_updated_at: '2026-01-01T00:00:00Z',
  relationships: null,
  relationships_v2: [],
  source: {
    anilist: { id: 85208, rating: 6.6, rating_normalized: 66 },
    anime_planet: { id: 'dice-the-cube-that-changes-everything', rating: 3.7, rating_normalized: 74 },
    anime_news_network: { id: null, rating: null, rating_normalized: null },
    kitsu: { id: 35879, rating: 7.21, rating_normalized: 72 },
    manga_updates: { id: 'rlpe3ta', rating: 7.53, rating_normalized: 75 },
    my_anime_list: { id: 147443, rating: 6.72, rating_normalized: 67 },
    shikimori: { id: 147443, rating: 6.72, rating_normalized: 67 },
  },
};

describe('mapMangabakaSeries', () => {
  it('maps a complete series correctly', () => {
    const result = mapMangabakaSeries(baseSeries);

    expect(result).toMatchObject({
      provider: MetadataProviderKey.MANGABAKA,
      providerId: '1',
      title: 'Dice',
      authors: ['Hyun-Seok Yun'],
      publisher: 'LINE Webtoon',
      publishedYear: 2013,
      publishedDate: '2013-05-18',
      genres: ['action', 'drama', 'psychological'],
      communityRating: 3.51,
      communityRatingCount: 794,
      coverUrl: 'https://cdn.mangabaka.dev/x250/1',
      sourceUrl: 'https://mangabaka.org/1',
      description: 'A manga about dice.',
    });
  });

  it('returns null when series has no id', () => {
    const series = { ...baseSeries, id: 0 };
    expect(mapMangabakaSeries(series)).toBeNull();
  });

  it('returns null when series is merged_with another', () => {
    const series = { ...baseSeries, merged_with: 42 };
    expect(mapMangabakaSeries(series)).toBeNull();
  });

  it('picks native title as subtitle when it differs from resolved main title', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      title: 'One Piece',
      native_title: 'ワンピース',
      romanized_title: null,
      titles: [
        { language: 'ja', traits: ['native'], title: 'ワンピース', note: null, is_primary: true },
        { language: 'en', traits: ['official'], title: 'One Piece', note: null, is_primary: true },
      ],
    };
    const result = mapMangabakaSeries(series);
    expect(result?.subtitle).toBe('ワンピース');
  });

  it('picks romanized title as subtitle when native title matches main title', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      title: '원피스',
      native_title: '원피스',
      romanized_title: 'One Piece',
      titles: [
        { language: 'ko', traits: ['native'], title: '원피스', note: null, is_primary: true },
        { language: 'en', traits: ['official'], title: 'One Piece', note: null, is_primary: true },
        { language: 'ko-Latn', traits: ['official'], title: 'One Piece', note: null, is_primary: false },
      ],
    };
    const result = mapMangabakaSeries(series);
    // Main title is 'One Piece' (en priority), subtitle is '원피스' (native, differs from main)
    expect(result?.subtitle).toBe('원피스');
  });

  it('omits subtitle when all titles share the same text', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      title: 'DICE',
      native_title: 'DICE',
      romanized_title: null,
      titles: [
        { language: 'ko', traits: ['native'], title: 'DICE', note: null, is_primary: true },
        { language: 'en', traits: ['official'], title: 'DICE', note: null, is_primary: true },
      ],
    };
    const result = mapMangabakaSeries(series);
    expect(result?.subtitle).toBeUndefined();
  });

  it('uses primary English title when available', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      title: 'DICE',
      titles: [
        { language: 'ko', traits: ['native'], title: '다이스', note: null, is_primary: true },
        { language: 'en', traits: ['official'], title: 'Dice: The Cube that Changes Everything', note: null, is_primary: true },
      ],
    };
    const result = mapMangabakaSeries(series);
    expect(result?.title).toBe('Dice: The Cube that Changes Everything');
  });

  it('falls back through language priority to ja-Latn when no English title', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      title: 'ソードアート・オンライン',
      romanized_title: 'Sword Art Online',
      titles: [
        { language: 'ja', traits: ['native'], title: 'ソードアート・オンライン', note: null, is_primary: true },
        { language: 'ja-Latn', traits: ['official'], title: 'Sword Art Online', note: null, is_primary: true },
      ],
    };
    const result = mapMangabakaSeries(series);
    expect(result?.title).toBe('Sword Art Online');
  });

  it('falls back to native title when no priority language matches', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      title: 'ソードアート・オンライン',
      romanized_title: null,
      titles: [{ language: 'ja', traits: ['native'], title: 'ソードアート・オンライン', note: null, is_primary: true }],
    };
    const result = mapMangabakaSeries(series);
    expect(result?.title).toBe('ソードアート・オンライン');
  });

  it('falls back to v1 title field when titles array is empty', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      title: 'ソードアート・オンライン',
      romanized_title: null,
      titles: [],
    };
    const result = mapMangabakaSeries(series);
    expect(result?.title).toBe('ソードアート・オンライン');
  });

  it('falls back to v1 romanized_title when titles array is empty', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      title: 'ソードアート・オンライン',
      romanized_title: 'Sword Art Online',
      titles: [],
    };
    const result = mapMangabakaSeries(series);
    expect(result?.title).toBe('Sword Art Online');
  });

  it('extracts year from year field', () => {
    const result = mapMangabakaSeries(baseSeries);
    expect(result?.publishedYear).toBe(2013);
  });

  it('extracts year from published.start_date when year is null', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      year: null,
      published: { start_date: '2020-06-15', end_date: null, start_date_is_estimated: false, end_date_is_estimated: false },
    };
    const result = mapMangabakaSeries(series);
    expect(result?.publishedYear).toBe(2020);
  });

  it('returns undefined publishedYear when no year and no start_date', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      year: null,
      published: null,
    };
    const result = mapMangabakaSeries(series);
    expect(result?.publishedYear).toBeUndefined();
  });

  it('uses English publisher over Original publisher', () => {
    const result = mapMangabakaSeries(baseSeries);
    expect(result?.publisher).toBe('LINE Webtoon');
  });

  it('falls back to Original publisher when no English publisher', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      publishers: [{ name: 'Naver', type: 'Original', note: '' }],
    };
    const result = mapMangabakaSeries(series);
    expect(result?.publisher).toBe('Naver');
  });

  it('returns undefined publisher when no publishers', () => {
    const series: MangabakaSeries = { ...baseSeries, publishers: [] };
    const result = mapMangabakaSeries(series);
    expect(result?.publisher).toBeUndefined();
  });

  it('limits genres to 10', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      genres: ['g1', 'g2', 'g3', 'g4', 'g5', 'g6', 'g7', 'g8', 'g9', 'g10', 'g11'],
    };
    const result = mapMangabakaSeries(series);
    expect(result?.genres?.length).toBe(10);
  });

  it('returns undefined genres when empty array', () => {
    const series: MangabakaSeries = { ...baseSeries, genres: [] };
    const result = mapMangabakaSeries(series);
    expect(result?.genres).toBeUndefined();
  });

  it('normalizes rating from 0-100 scale to 0-5 scale', () => {
    const result = mapMangabakaSeries(baseSeries);
    expect(result?.communityRating).toBeCloseTo(3.515, 1);
  });

  it('returns undefined communityRating when rating is null', () => {
    const series: MangabakaSeries = { ...baseSeries, rating: null };
    const result = mapMangabakaSeries(series);
    expect(result?.communityRating).toBeUndefined();
  });

  it('returns undefined communityRating when rating is not finite', () => {
    const series: MangabakaSeries = { ...baseSeries, rating: NaN };
    const result = mapMangabakaSeries(series);
    expect(result?.communityRating).toBeUndefined();
  });

  it('returns undefined coverUrl when cover is null', () => {
    const series: MangabakaSeries = { ...baseSeries, cover: null };
    const result = mapMangabakaSeries(series);
    expect(result?.coverUrl).toBeUndefined();
  });

  it('falls back through cover variants: x250 -> x350 -> x150 -> raw', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      cover: { ...baseSeries.cover!, x250: null, x350: { x1: 'https://cdn.mangabaka.dev/x350/1', x2: '', x3: '' } },
    };
    const result = mapMangabakaSeries(series);
    expect(result?.coverUrl).toBe('https://cdn.mangabaka.dev/x350/1');
  });

  it('falls back to x150 when x250 and x350 are null', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      cover: { ...baseSeries.cover!, x250: null, x350: null },
    };
    const result = mapMangabakaSeries(series);
    expect(result?.coverUrl).toBe('https://cdn.mangabaka.dev/x150/1');
  });

  it('falls back to raw cover URL when all variants are null', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      cover: { ...baseSeries.cover!, x250: null, x350: null, x150: null },
    };
    const result = mapMangabakaSeries(series);
    expect(result?.coverUrl).toBe('https://images.mangabaka.dev/test');
  });

  it('returns undefined description when description is null', () => {
    const series: MangabakaSeries = { ...baseSeries, description: null };
    const result = mapMangabakaSeries(series);
    expect(result?.description).toBeUndefined();
  });

  it('returns undefined description when description is empty string', () => {
    const series: MangabakaSeries = { ...baseSeries, description: '   ' };
    const result = mapMangabakaSeries(series);
    expect(result?.description).toBeUndefined();
  });

  it('returns undefined authors when authors is empty', () => {
    const series: MangabakaSeries = { ...baseSeries, authors: [] };
    const result = mapMangabakaSeries(series);
    expect(result?.authors).toBeUndefined();
  });

  it('constructs sourceUrl from links_v2 mangabaka link', () => {
    const result = mapMangabakaSeries(baseSeries);
    expect(result?.sourceUrl).toBe('https://mangabaka.org/1');
  });

  it('falls back to constructed sourceUrl when no mangabaka link in links_v2', () => {
    const series: MangabakaSeries = {
      ...baseSeries,
      links_v2: [],
    };
    const result = mapMangabakaSeries(series);
    expect(result?.sourceUrl).toBe('https://mangabaka.org/1');
  });

  it('returns publishedDate from published.start_date', () => {
    const result = mapMangabakaSeries(baseSeries);
    expect(result?.publishedDate).toBe('2013-05-18');
  });

  it('returns undefined publishedDate when published is null', () => {
    const series: MangabakaSeries = { ...baseSeries, published: null };
    const result = mapMangabakaSeries(series);
    expect(result?.publishedDate).toBeUndefined();
  });

  it('populates communityRatingCount from popularity.global.current', () => {
    const result = mapMangabakaSeries(baseSeries);
    expect(result?.communityRatingCount).toBe(794);
  });

  it('populates comicMetadata.pencillers from series.artists', () => {
    const result = mapMangabakaSeries(baseSeries);
    expect(result?.comicMetadata?.pencillers).toEqual(['Hyun-Seok Yun']);
  });

  it('does not populate seriesMemberships for series-level candidates', () => {
    const result = mapMangabakaSeries(baseSeries);
    expect(result?.seriesMemberships).toBeUndefined();
  });
});

const mockCollection: MangabakaCollection = {
  id: 'col-1',
  series_id: 1,
  title: 'Naruto Vol. 1',
  language: { iso: 'en', language: 'English' },
  publisher: { id: 1, type: 'publisher', sub_type: 'manga', aliases: null, parent_id: null, name: 'Viz Media' },
  edition: { id: 'ed-1', name: 'Standard', language: { iso: 'en', language: 'English' }, description: '', override_text: null },
  type: 'volume',
  format: 'paged',
  medium: 'paperback',
  status: 'published',
  reading: 'rtl',
  licensed: true,
  description: { desc: 'Volume 1 description', source: 'mangabaka' },
  note: null,
  start_date: '2003-01-01',
  end_date: null,
  links: [],
  related_collection_id: null,
  count_main: 10,
  count_extra: 0,
  count_other: 0,
  updated_at: '2024-01-01T00:00:00Z',
};

const mockWork: MangabakaWork = {
  id: '019e1d69-4210-767b-acd5-1de151bd138b',
  series_id: 1,
  source_ids: [{ id: 'src-1', name: 'mangabaka' }],
  sub_title: 'The Evil Spirit',
  count_type: 'main',
  images: [
    {
      id: 1,
      series_id: 1,
      work_id: '019e1d69-4210-767b-acd5-1de151bd138b',
      index: '1',
      index_numeric: 1,
      type: 'cover',
      language: 'en',
      note: null,
      content_rating: 'safe',
      created_at: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-01T00:00:00Z',
      hashes: {},
      image: {
        raw: { url: 'https://images.mangabaka.dev/raw', size: 50000, height: 800, width: 600, blurhash: 'test', thumbhash: 'test', format: 'jpeg' },
        x150: { x1: 'https://cdn.mangabaka.dev/x150/work', x2: '', x3: '' },
        x250: { x1: 'https://cdn.mangabaka.dev/x250/work', x2: '', x3: '' },
        x350: { x1: 'https://cdn.mangabaka.dev/x350/work', x2: '', x3: '' },
      },
    },
  ],
  release_date: '2003-03-15',
  sequence_string: '1',
  sequence_numeric: 1,
  identifiers: [{ id: '978-1-56931-900-0', name: 'isbn' }],
  trim: null,
  description: { desc: '  The first volume of Naruto.  ', source: 'mangabaka' },
  note: null,
  pages: 200,
  price: null,
  links: [],
  inc_chapters: null,
  part_of_volume: null,
  revision: null,
  updated_at: '2024-01-01T00:00:00Z',
  collections: [mockCollection],
};

describe('pickBestCollection', () => {
  it('prefers English volume collection over non-English', () => {
    const nonEnglish: MangabakaCollection = { ...mockCollection, language: { iso: 'ja', language: 'Japanese' } };
    const result = pickBestCollection([nonEnglish, mockCollection]);
    expect(result?.id).toBe('col-1');
  });

  it('prefers type "volume" over other types', () => {
    const nonVolume: MangabakaCollection = { ...mockCollection, type: 'omnibus', id: 'col-omnibus' };
    const result = pickBestCollection([nonVolume, mockCollection]);
    expect(result?.id).toBe('col-1');
  });

  it('prefers digital medium over paperback when all else is equal', () => {
    const digital: MangabakaCollection = { ...mockCollection, medium: 'digital', id: 'col-digital' };
    const result = pickBestCollection([mockCollection, digital]);
    expect(result?.id).toBe('col-digital');
  });

  it('caps count_main contribution at 50 to prevent domination', () => {
    const nonVolume: MangabakaCollection = {
      ...mockCollection,
      type: 'omnibus',
      id: 'col-omnibus',
      count_main: 200,
    };
    const volume: MangabakaCollection = {
      ...mockCollection,
      type: 'volume',
      id: 'col-volume',
      count_main: 5,
    };
    const result = pickBestCollection([nonVolume, volume]);
    // volume type (100) + count_main capped (5) = 105
    // omnibus type (0) + count_main capped (50) = 50
    expect(result?.id).toBe('col-volume');
  });

  it('returns null for empty array', () => {
    expect(pickBestCollection([])).toBeNull();
  });
});

describe('mapMangabakaWork', () => {
  it('maps all fields correctly', () => {
    const result = mapMangabakaWork(mockWork, baseSeries);

    expect(result).not.toBeNull();
    expect(result?.provider).toBe(MetadataProviderKey.MANGABAKA);
    expect(result?.providerId).toBe('019e1d69-4210-767b-acd5-1de151bd138b');
    expect(result?.title).toBe('Dice, Vol. 01: The Evil Spirit');
    expect(result?.subtitle).toBe('The Evil Spirit');
    expect(result?.authors).toEqual(['Hyun-Seok Yun']);
    expect(result?.description).toBe('The first volume of Naruto.');
    expect(result?.publisher).toBe('Viz Media');
    expect(result?.publishedDate).toBe('2003-03-15');
    expect(result?.publishedYear).toBe(2003);
    expect(result?.language).toBe('en');
    expect(result?.pageCount).toBe(200);
    expect(result?.isbn13).toBe('9781569319000');
    expect(result?.isbn10).toBeUndefined();
    expect(result?.seriesName).toBe('Dice');
    expect(result?.seriesIndex).toBe('1');
    expect(result?.genres).toEqual(['action', 'drama', 'psychological']);
    expect(result?.coverUrl).toBe('https://cdn.mangabaka.dev/x250/work');
    expect(result?.sourceUrl).toBe('https://mangabaka.org/work/019e1d69-4210-767b-acd5-1de151bd138b');
    expect(result?.communityRating).toBeCloseTo(3.515, 1);
    expect(result?.communityRatingCount).toBe(794);
  });

  it('returns null for work without id', () => {
    const result = mapMangabakaWork({ ...mockWork, id: '' }, baseSeries);
    expect(result).toBeNull();
  });

  it('handles missing optional fields', () => {
    const minimalWork: MangabakaWork = {
      ...mockWork,
      images: [],
      description: null,
      identifiers: [],
      sub_title: null,
      release_date: null,
      pages: null,
      collections: [],
    };
    const result = mapMangabakaWork(minimalWork, baseSeries);

    expect(result).not.toBeNull();
    expect(result?.coverUrl).toBeUndefined();
    expect(result?.description).toBeUndefined();
    expect(result?.subtitle).toBeUndefined();
    expect(result?.publishedDate).toBeUndefined();
    expect(result?.pageCount).toBeUndefined();
    expect(result?.isbn13).toBeUndefined();
    expect(result?.isbn10).toBeUndefined();
    expect(result?.language).toBeUndefined();
    expect(result?.publisher).toBe('LINE Webtoon');
  });

  it('classifies 13-digit ISBN as isbn13', () => {
    const work: MangabakaWork = {
      ...mockWork,
      identifiers: [{ id: '9781569319000', name: 'isbn' }],
    };
    const result = mapMangabakaWork(work, baseSeries);
    expect(result?.isbn13).toBe('9781569319000');
    expect(result?.isbn10).toBeUndefined();
  });

  it('classifies 10-digit ISBN as isbn10', () => {
    const work: MangabakaWork = {
      ...mockWork,
      identifiers: [{ id: '1569319000', name: 'isbn' }],
    };
    const result = mapMangabakaWork(work, baseSeries);
    expect(result?.isbn10).toBe('1569319000');
    expect(result?.isbn13).toBeUndefined();
  });

  it('classifies 979-prefix 13-digit ISBN as isbn13', () => {
    const work: MangabakaWork = {
      ...mockWork,
      identifiers: [{ id: '9791234567890', name: 'isbn' }],
    };
    const result = mapMangabakaWork(work, baseSeries);
    expect(result?.isbn13).toBe('9791234567890');
    expect(result?.isbn10).toBeUndefined();
  });

  it('handles ISBN with dashes and spaces', () => {
    const work: MangabakaWork = {
      ...mockWork,
      identifiers: [{ id: '978-1-56931-900-0', name: 'isbn' }],
    };
    const result = mapMangabakaWork(work, baseSeries);
    expect(result?.isbn13).toBe('9781569319000');
  });

  it('maps sequence_numeric of 0 to seriesIndex "0"', () => {
    const work: MangabakaWork = {
      ...mockWork,
      sequence_numeric: 0,
    };
    const result = mapMangabakaWork(work, baseSeries);
    expect(result?.seriesIndex).toBe('0');
  });

  it('falls back through work image variants: x250 -> x350 -> x150 -> raw', () => {
    const work: MangabakaWork = {
      ...mockWork,
      images: [
        {
          ...mockWork.images[0],
          image: {
            raw: {
              url: 'https://images.mangabaka.dev/raw',
              size: 50000,
              height: 800,
              width: 600,
              blurhash: 'test',
              thumbhash: 'test',
              format: 'jpeg',
            },
            x150: null,
            x250: null,
            x350: { x1: 'https://cdn.mangabaka.dev/x350/work', x2: '', x3: '' },
          },
        },
      ],
    };
    const result = mapMangabakaWork(work, baseSeries);
    expect(result?.coverUrl).toBe('https://cdn.mangabaka.dev/x350/work');
  });

  it('populates comicMetadata.pencillers from series.artists', () => {
    const result = mapMangabakaWork(mockWork, baseSeries);
    expect(result?.comicMetadata?.pencillers).toEqual(['Hyun-Seok Yun']);
  });

  it('does not populate comicMetadata.issueNumber (manga volumes are leaf units)', () => {
    const result = mapMangabakaWork(mockWork, baseSeries);
    expect(result?.comicMetadata?.issueNumber).toBeUndefined();
  });

  it('populates comicMetadata.volumeName from work.sub_title', () => {
    const result = mapMangabakaWork(mockWork, baseSeries);
    expect(result?.comicMetadata?.volumeName).toBe('The Evil Spirit');
  });

  it('populates seriesMemberships with series name, work sequence and collection volume count', () => {
    const result = mapMangabakaWork(mockWork, baseSeries);
    expect(result?.seriesMemberships).toEqual([{ seriesName: 'Dice', seriesIndex: '1', expectedBookCount: 10 }]);
  });

  it('formats title with volume and chapter when chapterNumber is provided (rich format)', () => {
    const result = mapMangabakaWork(mockWork, baseSeries, 3, { richTitleFormat: true, includeChapter: true });
    expect(result?.title).toBe('Dice, Vol. 01: The Evil Spirit, Ch 0003');
  });

  it('formats title with volume and chapter in flat format', () => {
    const result = mapMangabakaWork(mockWork, baseSeries, 3, { richTitleFormat: false });
    expect(result?.title).toBe('Dice, Vol. 01 - Ch 003');
  });

  it('formats title with volume and subtitle but no chapter when includeChapter is false', () => {
    const result = mapMangabakaWork(mockWork, baseSeries, 3, { richTitleFormat: true, includeChapter: false });
    expect(result?.title).toBe('Dice, Vol. 01: The Evil Spirit');
  });

  it('formats title with volume only when chapterNumber is undefined (rich format)', () => {
    const result = mapMangabakaWork(mockWork, baseSeries);
    expect(result?.title).toBe('Dice, Vol. 01: The Evil Spirit');
  });

  it('formats title with volume only when chapterNumber is explicitly undefined', () => {
    const result = mapMangabakaWork(mockWork, baseSeries, undefined);
    expect(result?.title).toBe('Dice, Vol. 01: The Evil Spirit');
  });

  it('omits subtitle from title when work has no sub_title', () => {
    const work: MangabakaWork = { ...mockWork, sub_title: null };
    const result = mapMangabakaWork(work, baseSeries);
    expect(result?.title).toBe('Dice, Vol. 01');
  });

  it('omits subtitle in flat format', () => {
    const work: MangabakaWork = { ...mockWork, sub_title: null };
    const result = mapMangabakaWork(work, baseSeries, undefined, { richTitleFormat: false });
    expect(result?.title).toBe('Dice, Vol. 01');
  });
});

describe('pickBestCollection with preferredLanguage', () => {
  const englishCollection = { ...mockCollection, id: 'col-en' };
  const frenchCollection: MangabakaCollection = {
    ...mockCollection,
    id: 'col-fr',
    language: { iso: 'fr', language: 'French' },
  };

  it('prefers French collection when preferredLanguage is fr', () => {
    const result = pickBestCollection([englishCollection, frenchCollection], 'fr');
    expect(result?.id).toBe('col-fr');
  });

  it('prefers English collection when no preferredLanguage (default)', () => {
    const result = pickBestCollection([frenchCollection, englishCollection]);
    expect(result?.id).toBe('col-en');
  });
});
