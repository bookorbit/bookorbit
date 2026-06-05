import { buildXmp } from './pdf-xmp-builder';

describe('buildXmp', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-02-03T04:05:06.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('emits XMP packet wrapper and escapes XML-sensitive characters', () => {
    const xmp = buildXmp(
      {
        title: 'Dune & <Messiah>',
        description: '"Epic" world',
      },
      new Set(['title', 'description']),
    );

    expect(xmp).toContain('<?xpacket begin=');
    expect(xmp).toContain('<dc:title>Dune &amp; &lt;Messiah&gt;</dc:title>');
    expect(xmp).toContain('<dc:description>&quot;Epic&quot; world</dc:description>');
    expect(xmp).toContain('<xmp:MetadataDate>2026-02-03T04:05:06.000Z</xmp:MetadataDate>');
    expect(xmp).toContain('<?xpacket end="w"?>');
  });

  it('normalizes Goodreads id and writes provider/tag fields only when masked', () => {
    const xmp = buildXmp(
      {
        goodreadsId: '44767458-dune',
        googleBooksId: 'g1',
        ranobedbId: 'ranobe-1',
        tags: ['space', 'classic'],
      },
      new Set(['goodreadsId', 'ranobedbId', 'tags']),
    );

    expect(xmp).toContain('<bookorbit:goodreadsId>44767458</bookorbit:goodreadsId>');
    expect(xmp).toContain('<bookorbit:ranobedbId>ranobe-1</bookorbit:ranobedbId>');
    expect(xmp).toContain('<bookorbit:tags>');
    expect(xmp).toContain('<rdf:li>space</rdf:li>');
    expect(xmp).not.toContain('googleBooksId');
  });

  it('writes series only when both seriesName and seriesIndex are selected and present', () => {
    const withBoth = buildXmp({ seriesName: 'Dune', seriesIndex: 1 }, new Set(['seriesName', 'seriesIndex']));
    expect(withBoth).toContain('<bookorbit:seriesName>Dune</bookorbit:seriesName>');
    expect(withBoth).toContain('<bookorbit:seriesIndex>1</bookorbit:seriesIndex>');

    const missingMask = buildXmp({ seriesName: 'Dune', seriesIndex: 1 }, new Set(['seriesName']));
    expect(missingMask).not.toContain('bookorbit:seriesName');
    expect(missingMask).not.toContain('bookorbit:seriesIndex');
  });

  it('writes every supported scalar, list, and provider field when selected', () => {
    const xmp = buildXmp(
      {
        title: 'Dune',
        authors: [
          { name: 'Frank Herbert', sortName: 'Herbert, Frank' },
          { name: 'Brian Herbert', sortName: null },
        ],
        description: 'Arrakis',
        publisher: 'Ace',
        publishedYear: 1965,
        language: 'en',
        genres: ['Science Fiction', 'Space Opera'],
        subtitle: 'Book One',
        seriesName: 'Dune',
        seriesIndex: 1,
        isbn13: '9780441172719',
        isbn10: '0441172717',
        pageCount: 412,
        rating: 5,
        googleBooksId: 'google-1',
        amazonId: 'amazon-1',
        hardcoverId: 'hardcover-1',
        openLibraryId: 'OL123W',
        itunesId: 'itunes-1',
        tags: ['classic'],
      },
      new Set([
        'title',
        'authors',
        'description',
        'publisher',
        'publishedYear',
        'language',
        'genres',
        'subtitle',
        'seriesName',
        'seriesIndex',
        'isbn13',
        'isbn10',
        'pageCount',
        'rating',
        'googleBooksId',
        'amazonId',
        'hardcoverId',
        'openLibraryId',
        'itunesId',
        'tags',
      ]),
    );

    expect(xmp).toContain('<dc:title>Dune</dc:title>');
    expect(xmp).toContain('<rdf:li>Frank Herbert</rdf:li>');
    expect(xmp).toContain('<dc:publisher>Ace</dc:publisher>');
    expect(xmp).toContain('<bookorbit:isbn13>9780441172719</bookorbit:isbn13>');
    expect(xmp).toContain('<bookorbit:googleBooksId>google-1</bookorbit:googleBooksId>');
    expect(xmp).toContain('<bookorbit:itunesId>itunes-1</bookorbit:itunesId>');
  });
});
