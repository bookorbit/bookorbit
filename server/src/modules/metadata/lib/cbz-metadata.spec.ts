jest.mock('fs/promises');
jest.mock('node-unrar-js');
jest.mock('../../../common/sevenzip');

import { readFile } from 'fs/promises';
import { extractCbzMetadata } from './cbz-metadata';

const mockReadFile = readFile as jest.MockedFunction<typeof readFile>;

// ── ZIP buffer builder ────────────────────────────────────────────────────────
// Builds a ZIP buffer with only local file headers (no central directory).
// extractZipFile scans local headers so this is sufficient.

function zipLocalEntry(name: string, content: Buffer): Buffer {
  const nameBuf = Buffer.from(name, 'utf-8');
  const header = Buffer.alloc(30 + nameBuf.length);
  header.writeUInt32LE(0x04034b50, 0); // local file signature
  header.writeUInt16LE(20, 4); // version needed
  header.writeUInt16LE(0, 6); // flags
  header.writeUInt16LE(0, 8); // compression: STORED
  header.writeUInt16LE(0, 10); // mod time
  header.writeUInt16LE(0, 12); // mod date
  header.writeUInt32LE(0, 14); // CRC32 (skipped)
  header.writeUInt32LE(content.length, 18); // compressed size
  header.writeUInt32LE(content.length, 22); // uncompressed size
  header.writeUInt16LE(nameBuf.length, 26); // file name length
  header.writeUInt16LE(0, 28); // extra field length
  nameBuf.copy(header, 30);
  return Buffer.concat([header, content]);
}

function buildZipWithComicInfo(xml: string, comment?: string): Buffer {
  const xmlBuf = Buffer.from(xml, 'utf-8');
  const entry = zipLocalEntry('ComicInfo.xml', xmlBuf);

  // Append a minimal EOCD so readZipComment can find the comment
  const commentBuf = comment ? Buffer.from(comment, 'utf-8') : Buffer.alloc(0);
  const eocd = Buffer.alloc(22 + commentBuf.length, 0);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // disk
  eocd.writeUInt16LE(0, 6); // start disk
  eocd.writeUInt16LE(1, 8); // entries on disk
  eocd.writeUInt16LE(1, 10); // total entries
  eocd.writeUInt32LE(0, 12); // central dir size
  eocd.writeUInt32LE(entry.length, 16); // central dir offset
  eocd.writeUInt16LE(commentBuf.length, 20);
  if (commentBuf.length) commentBuf.copy(eocd, 22);

  return Buffer.concat([entry, eocd]);
}

function buildZipCommentOnly(comment: string): Buffer {
  const commentBuf = Buffer.from(comment, 'utf-8');
  const eocd = Buffer.alloc(22 + commentBuf.length, 0);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(commentBuf.length, 20);
  commentBuf.copy(eocd, 22);
  return eocd;
}

beforeEach(() => jest.resetAllMocks());

describe('extractCbzMetadata', () => {
  describe('ComicInfo.xml parsing', () => {
    it('extracts title from ComicInfo.xml', async () => {
      const xml = `<ComicInfo><Title>My Comic</Title></ComicInfo>`;
      mockReadFile.mockResolvedValue(buildZipWithComicInfo(xml) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.title).toBe('My Comic');
    });

    it('extracts series name and issue number', async () => {
      const xml = `<ComicInfo><Series>Amazing Series</Series><Number>5</Number></ComicInfo>`;
      mockReadFile.mockResolvedValue(buildZipWithComicInfo(xml) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.seriesName).toBe('Amazing Series');
      expect(r?.seriesIndex).toBe(5);
    });

    it('extracts authors from Writer field', async () => {
      const xml = `<ComicInfo><Writer>Alan Moore</Writer></ComicInfo>`;
      mockReadFile.mockResolvedValue(buildZipWithComicInfo(xml) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.authors).toHaveLength(1);
      expect(r?.authors[0].name).toBe('Alan Moore');
      expect(r?.authors[0].sortName).toBeNull();
    });

    it('splits comma-separated writers into multiple authors', async () => {
      const xml = `<ComicInfo><Writer>Writer One, Writer Two</Writer></ComicInfo>`;
      mockReadFile.mockResolvedValue(buildZipWithComicInfo(xml) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.authors).toHaveLength(2);
      expect(r?.authors.map((a) => a.name)).toEqual(['Writer One', 'Writer Two']);
    });

    it('merges Genre and Tags into deduplicated tags array', async () => {
      const xml = `<ComicInfo><Genre>Superhero,Fantasy</Genre><Tags>Fantasy,Horror</Tags></ComicInfo>`;
      mockReadFile.mockResolvedValue(buildZipWithComicInfo(xml) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      // "Fantasy" appears in both Genre and Tags — must be deduplicated
      expect(r?.tags).toContain('Superhero');
      expect(r?.tags).toContain('Fantasy');
      expect(r?.tags).toContain('Horror');
      expect(r?.tags?.filter((t) => t === 'Fantasy')).toHaveLength(1);
    });

    it('extracts publisher, year, language, and summary', async () => {
      const xml = `<ComicInfo>
        <Publisher>DC Comics</Publisher>
        <Year>1986</Year>
        <LanguageISO>en</LanguageISO>
        <Summary>Watchmen summary.</Summary>
      </ComicInfo>`;
      mockReadFile.mockResolvedValue(buildZipWithComicInfo(xml) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.publisher).toBe('DC Comics');
      expect(r?.publishedYear).toBe(1986);
      expect(r?.language).toBe('en');
      expect(r?.description).toBe('Watchmen summary.');
    });

    it('truncates fractional year to integer', async () => {
      const xml = `<ComicInfo><Year>1986.5</Year></ComicInfo>`;
      mockReadFile.mockResolvedValue(buildZipWithComicInfo(xml) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.publishedYear).toBe(1986);
    });

    it('returns null for missing optional fields', async () => {
      const xml = `<ComicInfo><Title>Minimal</Title></ComicInfo>`;
      mockReadFile.mockResolvedValue(buildZipWithComicInfo(xml) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.publisher).toBeNull();
      expect(r?.publishedYear).toBeNull();
      expect(r?.seriesName).toBeNull();
    });
  });

  describe('ComicBookInfo/1.0 JSON comment fallback', () => {
    it('parses title and series from ComicBookInfo JSON', async () => {
      const comment = JSON.stringify({
        'ComicBookInfo/1.0': {
          title: 'JSON Comic',
          series: 'JSON Series',
          issue: 3,
          publicationYear: 2001,
          publisher: 'Image',
          credits: [],
          tags: [],
        },
      });
      mockReadFile.mockResolvedValue(buildZipCommentOnly(comment) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.title).toBe('JSON Comic');
      expect(r?.seriesName).toBe('JSON Series');
      expect(r?.seriesIndex).toBe(3);
      expect(r?.publishedYear).toBe(2001);
      expect(r?.publisher).toBe('Image');
    });

    it('extracts Writer credits as authors', async () => {
      const comment = JSON.stringify({
        'ComicBookInfo/1.0': {
          credits: [
            { person: 'Grant Morrison', role: 'Writer' },
            { person: 'Dave McKean', role: 'Artist' },
          ],
          tags: [],
        },
      });
      mockReadFile.mockResolvedValue(buildZipCommentOnly(comment) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.authors).toHaveLength(1);
      expect(r?.authors[0].name).toBe('Grant Morrison');
    });

    it('extracts tags array', async () => {
      const comment = JSON.stringify({
        'ComicBookInfo/1.0': { tags: ['superhero', 'action'], credits: [] },
      });
      mockReadFile.mockResolvedValue(buildZipCommentOnly(comment) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.tags).toEqual(['superhero', 'action']);
    });

    it('preserves issue 0 as a valid series index (origin issues)', async () => {
      const comment = JSON.stringify({
        'ComicBookInfo/1.0': { issue: 0, credits: [], tags: [] },
      });
      mockReadFile.mockResolvedValue(buildZipCommentOnly(comment) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.seriesIndex).toBe(0);
    });
  });

  describe('error handling', () => {
    it('returns null when file read fails', async () => {
      mockReadFile.mockRejectedValue(new Error('ENOENT'));
      expect(await extractCbzMetadata('/missing.cbz')).toBeNull();
    });

    it('returns null when ZIP has no ComicInfo.xml and no valid JSON comment', async () => {
      const emptyZip = Buffer.from([0x50, 0x4b, 0x05, 0x06, ...new Array(18).fill(0)]);
      mockReadFile.mockResolvedValue(emptyZip as unknown as Buffer);
      expect(await extractCbzMetadata('/empty.cbz')).toBeNull();
    });

    it('returns null when ComicInfo.xml has no ComicInfo root element', async () => {
      const xml = `<SomeOtherRoot><Title>Test</Title></SomeOtherRoot>`;
      mockReadFile.mockResolvedValue(buildZipWithComicInfo(xml) as unknown as Buffer);
      expect(await extractCbzMetadata('/bad.cbz')).toBeNull();
    });
  });
});
