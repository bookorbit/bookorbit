import { XMLParser } from 'fast-xml-parser';

import { buildComicInfoXml } from './comic-info-builder';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
});

describe('buildComicInfoXml', () => {
  it('maps payload fields to ComicInfo schema and normalizes values', () => {
    const xml = buildComicInfoXml(
      null,
      {
        title: 'Dune',
        description: '<p>Epic &amp; vast</p>',
        publisher: 'Ace',
        seriesName: 'Dune Saga',
        seriesIndex: 1,
        publishedYear: 1965,
        pageCount: 412,
        language: 'en',
        authors: [{ name: 'Frank Herbert', sortName: null }],
        genres: ['Sci-Fi'],
        tags: ['Classic'],
        rating: 8,
        isbn13: '9780441172719',
        goodreadsId: '44767458-dune',
        subtitle: 'Anniversary Edition',
        isbn10: '0441172717',
      },
      new Set([
        'title',
        'description',
        'publisher',
        'seriesName',
        'seriesIndex',
        'publishedYear',
        'pageCount',
        'language',
        'authors',
        'genres',
        'tags',
        'rating',
        'isbn13',
        'goodreadsId',
        'subtitle',
        'isbn10',
      ]),
    );

    const parsed = parser.parse(xml) as {
      ComicInfo: Record<string, string>;
    };

    expect(parsed.ComicInfo.Title).toBe('Dune');
    expect(parsed.ComicInfo.Summary).toBe('Epic & vast');
    expect(parsed.ComicInfo.Number).toBe('1');
    expect(parsed.ComicInfo.CommunityRating).toBe('4.0');
    expect(parsed.ComicInfo.Web).toBe('https://www.goodreads.com/book/show/44767458-dune');
    expect(parsed.ComicInfo.Notes).toContain('[projectx:subtitle] Anniversary Edition');
    expect(parsed.ComicInfo.Notes).toContain('[projectx:isbn10] 0441172717');
    expect(parsed.ComicInfo['@_xmlns:xsi']).toBeDefined();
    expect(parsed.ComicInfo['@_xmlns:xsd']).toBeDefined();
  });

  it('keeps existing non-projectx note lines while replacing managed lines', () => {
    const existing = `<?xml version="1.0"?><ComicInfo><Notes>Manual note\n[projectx:subtitle] old\n[projectx:goodreadsId] 1</Notes></ComicInfo>`;

    const xml = buildComicInfoXml(
      existing,
      {
        subtitle: 'new subtitle',
        goodreadsId: '2',
      },
      new Set(['subtitle', 'goodreadsId']),
    );

    const parsed = parser.parse(xml) as { ComicInfo: Record<string, string> };
    const notes = parsed.ComicInfo.Notes;

    expect(notes).toContain('Manual note');
    expect(notes).toContain('[projectx:subtitle] new subtitle');
    expect(notes).toContain('[projectx:goodreadsId] 2');
    expect(notes).not.toContain('[projectx:subtitle] old');
  });

  it('does not overwrite provider-derived Web/Notes when provider fields are excluded from field mask', () => {
    const existing = `<?xml version="1.0"?><ComicInfo><Web>https://www.goodreads.com/book/show/111</Web><Notes>[projectx:goodreadsId] 111</Notes></ComicInfo>`;

    const xml = buildComicInfoXml(
      existing,
      {
        title: 'Only Title Change',
        goodreadsId: '222',
      },
      new Set(['title']),
    );

    const parsed = parser.parse(xml) as { ComicInfo: Record<string, string> };

    expect(parsed.ComicInfo.Web).toBe('https://www.goodreads.com/book/show/111');
    expect(parsed.ComicInfo.Notes).toContain('[projectx:goodreadsId] 111');
    expect(parsed.ComicInfo.Notes).not.toContain('[projectx:goodreadsId] 222');
  });
});
