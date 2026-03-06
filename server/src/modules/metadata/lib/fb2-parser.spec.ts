jest.mock('fs/promises');

import { readFile } from 'fs/promises';
import { parseFb2File } from './fb2-parser';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

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
  jest.resetAllMocks();
});

describe('parseFb2File', () => {
  describe('title', () => {
    it('extracts book title', async () => {
      mockReadFile.mockResolvedValue(makeFb2('<book-title>War and Peace</book-title>') as unknown as Buffer);
      const r = await parseFb2File('/book.fb2');
      expect(r?.title).toBe('War and Peace');
    });

    it('returns null title when book-title element is absent (other fields present)', async () => {
      // title-info with only a lang tag — titleInfo is truthy but book-title is missing
      mockReadFile.mockResolvedValue(makeFb2('<lang>en</lang>') as unknown as Buffer);
      const r = await parseFb2File('/book.fb2');
      expect(r?.title).toBeNull();
    });
  });

  describe('authors', () => {
    it('constructs author name from first + last name', async () => {
      mockReadFile.mockResolvedValue(
        makeFb2(`
          <author>
            <first-name>Leo</first-name>
            <last-name>Tolstoy</last-name>
          </author>
        `) as unknown as Buffer,
      );
      const r = await parseFb2File('/book.fb2');
      expect(r?.authors).toHaveLength(1);
      expect(r?.authors[0].name).toBe('Leo Tolstoy');
      expect(r?.authors[0].sortName).toBe('Tolstoy, Leo');
    });

    it('includes middle name in display name', async () => {
      mockReadFile.mockResolvedValue(
        makeFb2(`
          <author>
            <first-name>John</first-name>
            <middle-name>Ronald Reuel</middle-name>
            <last-name>Tolkien</last-name>
          </author>
        `) as unknown as Buffer,
      );
      const r = await parseFb2File('/book.fb2');
      expect(r?.authors[0].name).toBe('John Ronald Reuel Tolkien');
      // sortName: last, first (middle not included)
      expect(r?.authors[0].sortName).toBe('Tolkien, John');
    });

    it('falls back to nickname when no name parts', async () => {
      mockReadFile.mockResolvedValue(
        makeFb2(`
          <author>
            <nickname>Voltaire</nickname>
          </author>
        `) as unknown as Buffer,
      );
      const r = await parseFb2File('/book.fb2');
      expect(r?.authors[0].name).toBe('Voltaire');
      expect(r?.authors[0].sortName).toBeNull();
    });

    it('parses multiple authors', async () => {
      mockReadFile.mockResolvedValue(
        makeFb2(`
          <author><first-name>Author</first-name><last-name>One</last-name></author>
          <author><first-name>Author</first-name><last-name>Two</last-name></author>
        `) as unknown as Buffer,
      );
      const r = await parseFb2File('/book.fb2');
      expect(r?.authors).toHaveLength(2);
    });

    it('returns empty authors array when no author elements', async () => {
      mockReadFile.mockResolvedValue(makeFb2('<book-title>Anon</book-title>') as unknown as Buffer);
      const r = await parseFb2File('/book.fb2');
      expect(r?.authors).toHaveLength(0);
    });
  });

  describe('genres', () => {
    it('extracts single genre', async () => {
      mockReadFile.mockResolvedValue(makeFb2('<genre>sci-fi</genre>') as unknown as Buffer);
      const r = await parseFb2File('/book.fb2');
      expect(r?.genres).toContain('sci-fi');
    });

    it('extracts multiple genres', async () => {
      mockReadFile.mockResolvedValue(makeFb2('<genre>sci-fi</genre><genre>adventure</genre>') as unknown as Buffer);
      const r = await parseFb2File('/book.fb2');
      expect(r?.genres).toEqual(['sci-fi', 'adventure']);
    });
  });

  describe('language', () => {
    it('extracts language code', async () => {
      mockReadFile.mockResolvedValue(makeFb2('<lang>ru</lang>') as unknown as Buffer);
      expect((await parseFb2File('/book.fb2'))?.language).toBe('ru');
    });
  });

  describe('series', () => {
    it('extracts series name and index from sequence element', async () => {
      mockReadFile.mockResolvedValue(makeFb2('<sequence name="The Dark Tower" number="1"/>') as unknown as Buffer);
      const r = await parseFb2File('/book.fb2');
      expect(r?.seriesName).toBe('The Dark Tower');
      expect(r?.seriesIndex).toBe(1);
    });

    it('parses float series index', async () => {
      mockReadFile.mockResolvedValue(makeFb2('<sequence name="Series" number="1.5"/>') as unknown as Buffer);
      expect((await parseFb2File('/book.fb2'))?.seriesIndex).toBe(1.5);
    });

    it('returns null seriesName when no sequence element', async () => {
      mockReadFile.mockResolvedValue(makeFb2('<book-title>Standalone</book-title>') as unknown as Buffer);
      const r = await parseFb2File('/book.fb2');
      expect(r?.seriesName).toBeNull();
      expect(r?.seriesIndex).toBeNull();
    });
  });

  describe('publishedYear', () => {
    it('extracts year from publish-info/year', async () => {
      mockReadFile.mockResolvedValue(makeFb2('<book-title>Book</book-title>', '<year>1869</year>') as unknown as Buffer);
      expect((await parseFb2File('/book.fb2'))?.publishedYear).toBe(1869);
    });

    it('rejects years outside 1000-2200 range', async () => {
      mockReadFile.mockResolvedValue(makeFb2('<book-title>Book</book-title>', '<year>900</year>') as unknown as Buffer);
      expect((await parseFb2File('/book.fb2'))?.publishedYear).toBeNull();
    });

    it('rejects years above 2200', async () => {
      mockReadFile.mockResolvedValue(makeFb2('<book-title>Book</book-title>', '<year>2500</year>') as unknown as Buffer);
      expect((await parseFb2File('/book.fb2'))?.publishedYear).toBeNull();
    });

    it('falls back to title-info/date when publish-info/year absent', async () => {
      mockReadFile.mockResolvedValue(makeFb2('<book-title>Book</book-title><date>1984</date>') as unknown as Buffer);
      expect((await parseFb2File('/book.fb2'))?.publishedYear).toBe(1984);
    });
  });

  describe('description (annotation)', () => {
    it('extracts plain string annotation', async () => {
      mockReadFile.mockResolvedValue(makeFb2('<annotation>Plain description text.</annotation>') as unknown as Buffer);
      expect((await parseFb2File('/book.fb2'))?.description).toBe('Plain description text.');
    });

    it('extracts text from structured annotation with paragraph tags', async () => {
      // Bug regression: previously JSON.stringify was used, producing {"p":"text"}
      mockReadFile.mockResolvedValue(makeFb2('<annotation><p>Description with paragraph.</p></annotation>') as unknown as Buffer);
      const r = await parseFb2File('/book.fb2');
      expect(r?.description).not.toContain('{');
      expect(r?.description).not.toContain('"p":');
      expect(r?.description).toContain('Description with paragraph.');
    });

    it('returns null description when annotation absent', async () => {
      mockReadFile.mockResolvedValue(makeFb2('<book-title>No Desc</book-title>') as unknown as Buffer);
      expect((await parseFb2File('/book.fb2'))?.description).toBeNull();
    });
  });

  describe('error handling', () => {
    it('returns null when file read throws', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      expect(await parseFb2File('/missing.fb2')).toBeNull();
    });

    it('returns null when XML has no FictionBook root', async () => {
      mockReadFile.mockResolvedValue('<notfiction/>' as unknown as Buffer);
      expect(await parseFb2File('/bad.fb2')).toBeNull();
    });

    it('returns null when title-info is missing', async () => {
      mockReadFile.mockResolvedValue(`<FictionBook><description></description></FictionBook>` as unknown as Buffer);
      expect(await parseFb2File('/bad.fb2')).toBeNull();
    });
  });
});
