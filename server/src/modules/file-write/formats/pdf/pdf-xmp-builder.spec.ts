import { buildXmp } from './pdf-xmp-builder';

describe('buildXmp', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-02-03T04:05:06.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
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
        tags: ['space', 'classic'],
      },
      new Set(['goodreadsId', 'tags']),
    );

    expect(xmp).toContain('<projectx:goodreadsId>44767458</projectx:goodreadsId>');
    expect(xmp).toContain('<projectx:tags>');
    expect(xmp).toContain('<rdf:li>space</rdf:li>');
    expect(xmp).not.toContain('googleBooksId');
  });

  it('writes series only when both seriesName and seriesIndex are selected and present', () => {
    const withBoth = buildXmp(
      { seriesName: 'Dune', seriesIndex: 1 },
      new Set(['seriesName', 'seriesIndex']),
    );
    expect(withBoth).toContain('<projectx:seriesName>Dune</projectx:seriesName>');
    expect(withBoth).toContain('<projectx:seriesIndex>1</projectx:seriesIndex>');

    const missingMask = buildXmp(
      { seriesName: 'Dune', seriesIndex: 1 },
      new Set(['seriesName']),
    );
    expect(missingMask).not.toContain('projectx:seriesName');
    expect(missingMask).not.toContain('projectx:seriesIndex');
  });
});
