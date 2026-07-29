vi.mock('fs/promises');

import { readFile } from 'fs/promises';
import iconv from 'iconv-lite';

import { parseFb2File } from './fb2-parser';

const mockReadFile = readFile as MockedFunction<typeof readFile>;

function fb2Buffer(titleInfo: string, publishInfo = '', description = ''): Buffer {
  return Buffer.from(makeFb2(titleInfo, publishInfo, description), 'utf8');
}

function makeFb2(titleInfo: string, publishInfo = '', description = ''): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info>
      ${titleInfo}
    </title-info>
    ${publishInfo ? `<publish-info>${publishInfo}</publish-info>` : ''}
  </description>
  ${description}
</FictionBook>`;
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe('parseFb2File', () => {
  describe('title', () => {
    it('extracts book title', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<book-title>War and Peace</book-title>'));
      const r = await parseFb2File('/book.fb2');
      expect(r?.title).toBe('War and Peace');
    });

    it('returns null title when book-title element is absent (other fields present)', async () => {
      // title-info with only a lang tag — titleInfo is truthy but book-title is missing
      mockReadFile.mockResolvedValue(fb2Buffer('<lang>en</lang>'));
      const r = await parseFb2File('/book.fb2');
      expect(r?.title).toBeNull();
    });
  });

  describe('authors', () => {
    it('constructs author name from first + last name', async () => {
      mockReadFile.mockResolvedValue(
        fb2Buffer(`
          <author>
            <first-name>Leo</first-name>
            <last-name>Tolstoy</last-name>
          </author>
        `),
      );
      const r = await parseFb2File('/book.fb2');
      expect(r?.authors).toHaveLength(1);
      expect(r?.authors[0].name).toBe('Leo Tolstoy');
      expect(r?.authors[0].sortName).toBe('Tolstoy, Leo');
    });

    it('includes middle name in display name', async () => {
      mockReadFile.mockResolvedValue(
        fb2Buffer(`
          <author>
            <first-name>John</first-name>
            <middle-name>Ronald Reuel</middle-name>
            <last-name>Tolkien</last-name>
          </author>
        `),
      );
      const r = await parseFb2File('/book.fb2');
      expect(r?.authors[0].name).toBe('John Ronald Reuel Tolkien');
      // sortName: last, first (middle not included)
      expect(r?.authors[0].sortName).toBe('Tolkien, John');
    });

    it('falls back to nickname when no name parts', async () => {
      mockReadFile.mockResolvedValue(
        fb2Buffer(`
          <author>
            <nickname>Voltaire</nickname>
          </author>
        `),
      );
      const r = await parseFb2File('/book.fb2');
      expect(r?.authors[0].name).toBe('Voltaire');
      expect(r?.authors[0].sortName).toBeNull();
    });

    it('parses multiple authors', async () => {
      mockReadFile.mockResolvedValue(
        fb2Buffer(`
          <author><first-name>Author</first-name><last-name>One</last-name></author>
          <author><first-name>Author</first-name><last-name>Two</last-name></author>
        `),
      );
      const r = await parseFb2File('/book.fb2');
      expect(r?.authors).toHaveLength(2);
    });

    it('returns empty authors array when no author elements', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<book-title>Anon</book-title>'));
      const r = await parseFb2File('/book.fb2');
      expect(r?.authors).toHaveLength(0);
    });
  });

  describe('genres', () => {
    it('extracts single genre', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<genre>sci-fi</genre>'));
      const r = await parseFb2File('/book.fb2');
      expect(r?.genres).toContain('sci-fi');
    });

    it('extracts multiple genres', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<genre>sci-fi</genre><genre>adventure</genre>'));
      const r = await parseFb2File('/book.fb2');
      expect(r?.genres).toEqual(['sci-fi', 'adventure']);
    });
  });

  describe('language', () => {
    it('extracts language code', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<lang>ru</lang>'));
      expect((await parseFb2File('/book.fb2'))?.language).toBe('ru');
    });
  });

  describe('series', () => {
    it('extracts series name and index from sequence element', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<sequence name="The Dark Tower" number="1"/>'));
      const r = await parseFb2File('/book.fb2');
      expect(r?.seriesName).toBe('The Dark Tower');
      expect(r?.seriesIndex).toBe(1);
    });

    it('parses float series index', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<sequence name="Series" number="1.5"/>'));
      expect((await parseFb2File('/book.fb2'))?.seriesIndex).toBe(1.5);
    });

    it('returns null seriesName when no sequence element', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<book-title>Standalone</book-title>'));
      const r = await parseFb2File('/book.fb2');
      expect(r?.seriesName).toBeNull();
      expect(r?.seriesIndex).toBeNull();
    });
  });

  describe('publishedYear', () => {
    it('extracts year from publish-info/year', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<book-title>Book</book-title>', '<year>1869</year>'));
      expect((await parseFb2File('/book.fb2'))?.publishedYear).toBe(1869);
    });

    it('rejects years outside 1000-2200 range', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<book-title>Book</book-title>', '<year>900</year>'));
      expect((await parseFb2File('/book.fb2'))?.publishedYear).toBeNull();
    });

    it('rejects years above 2200', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<book-title>Book</book-title>', '<year>2500</year>'));
      expect((await parseFb2File('/book.fb2'))?.publishedYear).toBeNull();
    });

    it('falls back to title-info/date when publish-info/year absent', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<book-title>Book</book-title><date>1984</date>'));
      expect((await parseFb2File('/book.fb2'))?.publishedYear).toBe(1984);
    });

    it('parses year from title-info/date value attribute', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<book-title>Book</book-title><date value="1984-01-01"/>'));
      expect((await parseFb2File('/book.fb2'))?.publishedYear).toBe(1984);
    });
  });

  describe('description (annotation)', () => {
    it('extracts plain string annotation', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<annotation>Plain description text.</annotation>'));
      expect((await parseFb2File('/book.fb2'))?.description).toBe('Plain description text.');
    });

    it('extracts text from structured annotation with paragraph tags', async () => {
      // Bug regression: previously JSON.stringify was used, producing {"p":"text"}
      mockReadFile.mockResolvedValue(fb2Buffer('<annotation><p>Description with paragraph.</p></annotation>'));
      const r = await parseFb2File('/book.fb2');
      expect(r?.description).not.toContain('{');
      expect(r?.description).not.toContain('"p":');
      expect(r?.description).toContain('Description with paragraph.');
    });

    it('returns null description when annotation absent', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<book-title>No Desc</book-title>'));
      expect((await parseFb2File('/book.fb2'))?.description).toBeNull();
    });
  });

  describe('publishedDate', () => {
    it('prefers a full date in title-info over a bare publish-info year', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<date value="2018-03-14">2018-03-14</date>', '<year>2018</year>'));
      const r = await parseFb2File('/book.fb2');
      expect(r?.publishedDate).toBe('2018-03-14');
      expect(r?.publishedYear).toBe(2018);
    });

    it('keeps the publish-info year when the years disagree', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<date value="2018-03-14">2018-03-14</date>', '<year>1975</year>'));
      const r = await parseFb2File('/book.fb2');
      expect(r?.publishedDate).toBe('2018-03-14');
      expect(r?.publishedYear).toBe(1975);
    });

    it('returns a null date when only a year is recorded', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<book-title>Book</book-title>', '<year>1999</year>'));
      const r = await parseFb2File('/book.fb2');
      expect(r?.publishedDate).toBeNull();
      expect(r?.publishedYear).toBe(1999);
    });

    it('reads a full date from title-info when publish-info is absent', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<date value="2001-02-03">2001-02-03</date>'));
      expect((await parseFb2File('/book.fb2'))?.publishedDate).toBe('2001-02-03');
    });
  });

  describe('publish-info fields', () => {
    it('extracts publisher and isbn', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<book-title>Book</book-title>', '<publisher>Kensington Books</publisher><isbn>9781729419007</isbn>'));
      const r = await parseFb2File('/book.fb2');
      expect(r?.publisher).toBe('Kensington Books');
      expect(r?.isbn13).toBe('9781729419007');
    });

    it('returns nulls when publish-info is absent', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<book-title>Book</book-title>'));
      const r = await parseFb2File('/book.fb2');
      expect(r?.publisher).toBeNull();
      expect(r?.isbn13).toBeNull();
    });
  });

  describe('tags (keywords)', () => {
    it('splits keywords on commas', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<keywords>favourite, to-reread ,  sci-fi</keywords>'));
      expect((await parseFb2File('/book.fb2'))?.tags).toEqual(['favourite', 'to-reread', 'sci-fi']);
    });

    it('returns an empty list when keywords are absent', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<book-title>Book</book-title>'));
      expect((await parseFb2File('/book.fb2'))?.tags).toEqual([]);
    });
  });

  describe('custom-info', () => {
    function withCustomInfo(entries: string): Buffer {
      return Buffer.from(
        `<?xml version="1.0" encoding="utf-8"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description>
    <title-info><book-title>Book</book-title></title-info>
    ${entries}
  </description>
</FictionBook>`,
        'utf8',
      );
    }

    it('reads namespaced fields written by BookOrbit', async () => {
      mockReadFile.mockResolvedValue(
        withCustomInfo(
          [
            '<custom-info info-type="bookorbit:subtitle">A Subtitle</custom-info>',
            '<custom-info info-type="bookorbit:rating">4.5</custom-info>',
            '<custom-info info-type="bookorbit:pageCount">412</custom-info>',
            '<custom-info info-type="bookorbit:goodreadsId">12345</custom-info>',
            '<custom-info info-type="bookorbit:isbn10">1729419001</custom-info>',
          ].join('\n    '),
        ),
      );
      const r = await parseFb2File('/book.fb2');
      expect(r?.custom).toEqual({
        subtitle: 'A Subtitle',
        rating: '4.5',
        pageCount: '412',
        goodreadsId: '12345',
        isbn10: '1729419001',
      });
    });

    it('ignores custom-info written by other tools', async () => {
      mockReadFile.mockResolvedValue(withCustomInfo('<custom-info info-type="calibre-uuid">abc-123</custom-info>'));
      expect((await parseFb2File('/book.fb2'))?.custom).toEqual({});
    });

    it('ignores namespaced keys it does not recognise', async () => {
      mockReadFile.mockResolvedValue(withCustomInfo('<custom-info info-type="bookorbit:notAField">x</custom-info>'));
      expect((await parseFb2File('/book.fb2'))?.custom).toEqual({});
    });

    it('returns an empty object when there is no custom-info', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<book-title>Book</book-title>'));
      expect((await parseFb2File('/book.fb2'))?.custom).toEqual({});
    });
  });

  describe('encodings', () => {
    it('decodes a windows-1251 document using its declared encoding', async () => {
      const xml = `<?xml version="1.0" encoding="windows-1251"?>
<FictionBook xmlns="http://www.gribuser.ru/xml/fictionbook/2.0">
  <description><title-info>
    <author><first-name>Михаил</first-name><last-name>Булгаков</last-name></author>
    <book-title>Мастер и Маргарита</book-title>
  </title-info></description>
</FictionBook>`;
      mockReadFile.mockResolvedValue(iconv.encode(xml, 'win1251'));
      const r = await parseFb2File('/book.fb2');
      expect(r?.title).toBe('Мастер и Маргарита');
      expect(r?.authors[0]?.name).toBe('Михаил Булгаков');
    });

    it('decodes a koi8-r document', async () => {
      const xml = `<?xml version="1.0" encoding="koi8-r"?>
<FictionBook><description><title-info><book-title>Пикник</book-title></title-info></description></FictionBook>`;
      mockReadFile.mockResolvedValue(iconv.encode(xml, 'koi8-r'));
      expect((await parseFb2File('/book.fb2'))?.title).toBe('Пикник');
    });

    it('still reads utf-8 documents', async () => {
      mockReadFile.mockResolvedValue(fb2Buffer('<book-title>Über den Bergen</book-title>'));
      expect((await parseFb2File('/book.fb2'))?.title).toBe('Über den Bergen');
    });
  });

  describe('error handling', () => {
    it('returns null when file read throws', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      expect(await parseFb2File('/missing.fb2')).toBeNull();
    });

    it('returns null when XML has no FictionBook root', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('<notfiction/>'));
      expect(await parseFb2File('/bad.fb2')).toBeNull();
    });

    it('returns null when title-info is missing', async () => {
      mockReadFile.mockResolvedValue(Buffer.from('<FictionBook><description></description></FictionBook>'));
      expect(await parseFb2File('/bad.fb2')).toBeNull();
    });
  });
});
