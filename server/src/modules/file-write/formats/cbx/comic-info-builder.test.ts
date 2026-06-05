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
        ranobedbId: 'ranobe-1',
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
        'ranobedbId',
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
    expect(parsed.ComicInfo.Notes).toContain('[bookorbit:subtitle] Anniversary Edition');
    expect(parsed.ComicInfo.Notes).toContain('[bookorbit:isbn10] 0441172717');
    expect(parsed.ComicInfo.Notes).toContain('[bookorbit:ranobedbId] ranobe-1');
    expect(parsed.ComicInfo['@_xmlns:xsi']).toBeDefined();
    expect(parsed.ComicInfo['@_xmlns:xsd']).toBeDefined();
  });

  it('writes comic-specific ComicInfo fields and prefers comic issue number', () => {
    const xml = buildComicInfoXml(
      null,
      {
        seriesIndex: 1,
        comicIssueNumber: '12A',
        comicVolumeName: 'Year One',
        comicPencillers: ['Penciller A', 'Penciller B'],
        comicInkers: ['Inker A'],
        comicColorists: ['Colorist A'],
        comicLetterers: ['Letterer A'],
        comicCoverArtists: ['Cover Artist A'],
        comicCharacters: ['Character A'],
        comicTeams: ['Team A'],
        comicLocations: ['Location A'],
        comicStoryArcs: ['Arc A'],
      },
      new Set([
        'seriesIndex',
        'comicIssueNumber',
        'comicVolumeName',
        'comicPencillers',
        'comicInkers',
        'comicColorists',
        'comicLetterers',
        'comicCoverArtists',
        'comicCharacters',
        'comicTeams',
        'comicLocations',
        'comicStoryArcs',
      ]),
    );

    const parsed = parser.parse(xml) as { ComicInfo: Record<string, string> };

    expect(parsed.ComicInfo.Number).toBe('12A');
    expect(parsed.ComicInfo.Volume).toBe('Year One');
    expect(parsed.ComicInfo.Penciller).toBe('Penciller A, Penciller B');
    expect(parsed.ComicInfo.Inker).toBe('Inker A');
    expect(parsed.ComicInfo.Colorist).toBe('Colorist A');
    expect(parsed.ComicInfo.Letterer).toBe('Letterer A');
    expect(parsed.ComicInfo.CoverArtist).toBe('Cover Artist A');
    expect(parsed.ComicInfo.Characters).toBe('Character A');
    expect(parsed.ComicInfo.Teams).toBe('Team A');
    expect(parsed.ComicInfo.Locations).toBe('Location A');
    expect(parsed.ComicInfo.StoryArc).toBe('Arc A');
  });

  it('clears selected comic-specific fields when payload values are empty', () => {
    const existing = `<?xml version="1.0"?><ComicInfo><Number>12</Number><Penciller>A</Penciller><Colorist>B</Colorist></ComicInfo>`;

    const xml = buildComicInfoXml(
      existing,
      { comicIssueNumber: '   ', comicPencillers: [], comicColorists: [] },
      new Set(['comicIssueNumber', 'comicPencillers', 'comicColorists']),
    );

    const parsed = parser.parse(xml) as { ComicInfo: Record<string, string> };

    expect(parsed.ComicInfo.Number).toBeUndefined();
    expect(parsed.ComicInfo.Penciller).toBeUndefined();
    expect(parsed.ComicInfo.Colorist).toBeUndefined();
  });

  it('keeps existing non-bookorbit note lines while replacing managed lines', () => {
    const existing = `<?xml version="1.0"?><ComicInfo><Notes>Manual note\n[bookorbit:subtitle] old\n[bookorbit:goodreadsId] 1</Notes></ComicInfo>`;

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
    expect(notes).toContain('[bookorbit:subtitle] new subtitle');
    expect(notes).toContain('[bookorbit:goodreadsId] 2');
    expect(notes).not.toContain('[bookorbit:subtitle] old');
  });

  it('does not overwrite provider-derived Web/Notes when provider fields are excluded from field mask', () => {
    const existing = `<?xml version="1.0"?><ComicInfo><Web>https://www.goodreads.com/book/show/111</Web><Notes>[bookorbit:goodreadsId] 111</Notes></ComicInfo>`;

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
    expect(parsed.ComicInfo.Notes).toContain('[bookorbit:goodreadsId] 111');
    expect(parsed.ComicInfo.Notes).not.toContain('[bookorbit:goodreadsId] 222');
  });

  describe('stripHtml (via description field)', () => {
    function summaryOf(description: string): string {
      const xml = buildComicInfoXml(null, { description }, new Set(['description']));
      const parsed = parser.parse(xml) as { ComicInfo: Record<string, string> };
      return parsed.ComicInfo.Summary ?? '';
    }

    it('strips plain HTML tags', () => {
      expect(summaryOf('<p>Hello <b>world</b></p>')).toBe('Hello world');
    });

    it('decodes &amp; entity in plain text', () => {
      expect(summaryOf('Rock &amp; Roll')).toBe('Rock & Roll');
    });

    it('decodes entity-encoded tags before stripping - prevents double-escaping bypass', () => {
      // Old (buggy) order: strip tags first, then decode -> &lt;b&gt;text&lt;/b&gt; survives
      // New (correct) order: decode first -> <b>text</b>, then strip -> text
      expect(summaryOf('&lt;b&gt;bold text&lt;/b&gt;')).toBe('bold text');
    });

    it('removes entity-encoded script tags to prevent bypass', () => {
      const result = summaryOf('&lt;script src="evil.js"&gt;alert(1)&lt;/script&gt; safe');
      expect(result).not.toContain('<script');
      expect(result).not.toContain('</script');
      expect(result).toContain('safe');
    });

    it('handles mixed HTML and entities correctly', () => {
      expect(summaryOf('<p>Epic &amp; vast</p>')).toBe('Epic & vast');
    });

    it('handles &quot; and &#39; entities', () => {
      expect(summaryOf('She said &quot;hello&quot; and it&#39;s fine')).toBe(`She said "hello" and it's fine`);
    });

    it('collapses extra whitespace from removed tags', () => {
      expect(summaryOf('<p>  lots   of   space  </p>')).toBe('lots of space');
    });
  });
});
