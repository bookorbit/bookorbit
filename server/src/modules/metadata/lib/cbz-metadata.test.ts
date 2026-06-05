vi.mock('fs/promises');
vi.mock('node-unrar-js');
vi.mock('../../../common/sevenzip');

import { readFile } from 'fs/promises';
import { getSevenZip } from '../../../common/sevenzip';
import { extractCb7Metadata, extractCbzMetadata } from './cbz-metadata';

const mockReadFile = readFile as MockedFunction<typeof readFile>;
const mockGetSevenZip = getSevenZip as MockedFunction<typeof getSevenZip>;

// ── ZIP buffer builder ────────────────────────────────────────────────────────
// Builds a ZIP buffer with local file headers + central directory + EOCD.

interface ZipEntry {
  name: string;
  data: Buffer;
  dataDescriptor?: boolean;
}

function buildZip(entries: ZipEntry[], eocdComment?: Buffer): Buffer {
  const lfhChunks: Buffer[] = [];
  const cdrChunks: Buffer[] = [];
  let lfhOffset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf-8');
    const lfhCompressedSize = entry.dataDescriptor ? 0 : entry.data.length;

    const lfh = Buffer.alloc(30 + nameBuf.length);
    lfh.writeUInt32LE(0x04034b50, 0);
    lfh.writeUInt16LE(20, 4);
    lfh.writeUInt16LE(entry.dataDescriptor ? 0x0008 : 0, 6);
    lfh.writeUInt16LE(0, 8); // STORED
    lfh.writeUInt32LE(lfhCompressedSize, 18);
    lfh.writeUInt32LE(entry.data.length, 22);
    lfh.writeUInt16LE(nameBuf.length, 26);
    lfh.writeUInt16LE(0, 28);
    nameBuf.copy(lfh, 30);

    const lfhBlock = Buffer.concat([lfh, entry.data]);
    lfhChunks.push(lfhBlock);

    const cdr = Buffer.alloc(46 + nameBuf.length);
    cdr.writeUInt32LE(0x02014b50, 0);
    cdr.writeUInt16LE(20, 4);
    cdr.writeUInt16LE(20, 6);
    cdr.writeUInt16LE(entry.dataDescriptor ? 0x0008 : 0, 8);
    cdr.writeUInt16LE(0, 10); // STORED
    cdr.writeUInt32LE(entry.data.length, 20);
    cdr.writeUInt32LE(entry.data.length, 24);
    cdr.writeUInt16LE(nameBuf.length, 28);
    cdr.writeUInt32LE(lfhOffset, 42);
    nameBuf.copy(cdr, 46);
    cdrChunks.push(cdr);

    lfhOffset += lfhBlock.length;
  }

  const cdData = Buffer.concat(cdrChunks);
  const comment = eocdComment ?? Buffer.alloc(0);
  const eocd = Buffer.alloc(22 + comment.length);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(cdData.length, 12);
  eocd.writeUInt32LE(lfhOffset, 16);
  eocd.writeUInt16LE(comment.length, 20);
  comment.copy(eocd, 22);

  return Buffer.concat([...lfhChunks, cdData, eocd]);
}

function buildZipWithComicInfo(xml: string, comment?: string, options?: { dataDescriptor?: boolean }): Buffer {
  const xmlBuf = Buffer.from(xml, 'utf-8');
  const commentBuf = comment ? Buffer.from(comment, 'utf-8') : undefined;
  return buildZip([{ name: 'ComicInfo.xml', data: xmlBuf, dataDescriptor: options?.dataDescriptor }], commentBuf);
}

function buildZipCommentOnly(comment: string): Buffer {
  return buildZip([], Buffer.from(comment, 'utf-8'));
}

beforeEach(() => vi.resetAllMocks());

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

    it('extracts Genre and Tags into separate deduplicated lists', async () => {
      const xml = `<ComicInfo><Genre>Superhero,Fantasy</Genre><Tags>Fantasy,Horror</Tags></ComicInfo>`;
      mockReadFile.mockResolvedValue(buildZipWithComicInfo(xml) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.genres).toContain('Superhero');
      expect(r?.genres).toContain('Fantasy');
      expect(r?.genres?.filter((t) => t === 'Fantasy')).toHaveLength(1);

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

    it('maps CommunityRating from 0-5 scale into 0-10 scale', async () => {
      const xml = `<ComicInfo><CommunityRating>4.5</CommunityRating></ComicInfo>`;
      mockReadFile.mockResolvedValue(buildZipWithComicInfo(xml) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.rating).toBe(9);
    });

    it('clamps CommunityRating to a maximum of 10 after scaling', async () => {
      const xml = `<ComicInfo><CommunityRating>8</CommunityRating></ComicInfo>`;
      mockReadFile.mockResolvedValue(buildZipWithComicInfo(xml) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.rating).toBe(10);
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

    it('extracts ComicInfo.xml when local header size is zero (data descriptor mode)', async () => {
      const xml = `<ComicInfo><Title>Descriptor Comic</Title></ComicInfo>`;
      mockReadFile.mockResolvedValue(buildZipWithComicInfo(xml, undefined, { dataDescriptor: true }) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.title).toBe('Descriptor Comic');
    });

    it('extracts RanobeDB ID from managed BookOrbit notes', async () => {
      const xml = `<ComicInfo>
        <Notes>
          Manual note
          [bookorbit:ranobedbId] ranobe-1
          [bookorbit:googleBooksId] google-1
        </Notes>
      </ComicInfo>`;
      mockReadFile.mockResolvedValue(buildZipWithComicInfo(xml) as unknown as Buffer);

      const r = await extractCbzMetadata('/book.cbz');
      expect(r?.ranobedbId).toBe('ranobe-1');
      expect(r?.googleBooksId).toBe('google-1');
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

describe('extractCb7Metadata', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockReadFile.mockResolvedValue(Buffer.from('7z') as unknown as Buffer);
  });

  it('parses ComicInfo.xml and cleans up wasm VFS artifacts', async () => {
    const fsApi = {
      open: vi.fn().mockReturnValue(1),
      write: vi.fn(),
      close: vi.fn(),
      mkdir: vi.fn(),
      readFile: vi.fn().mockReturnValue(Uint8Array.from(Buffer.from('<ComicInfo><Title>CB7 Comic</Title></ComicInfo>'))),
      readdir: vi.fn().mockReturnValue(['.', '..', 'ComicInfo.xml']),
      unlink: vi.fn(),
      rmdir: vi.fn(),
    };

    mockGetSevenZip.mockResolvedValue({ FS: fsApi, callMain: vi.fn() } as any);

    const result = await extractCb7Metadata('/book.cb7');

    expect(result?.title).toBe('CB7 Comic');
    expect(fsApi.rmdir).toHaveBeenCalled();
    expect(fsApi.unlink).toHaveBeenCalled();
  });

  it('cleans up artifacts even when extraction command throws', async () => {
    const fsApi = {
      open: vi.fn().mockReturnValue(1),
      write: vi.fn(),
      close: vi.fn(),
      mkdir: vi.fn(),
      readFile: vi.fn(),
      readdir: vi.fn().mockReturnValue(['.', '..']),
      unlink: vi.fn(),
      rmdir: vi.fn(),
    };
    const callMain = vi.fn().mockImplementation(() => {
      throw new Error('extract failed');
    });

    mockGetSevenZip.mockResolvedValue({ FS: fsApi, callMain } as any);

    await expect(extractCb7Metadata('/book.cb7')).resolves.toBeNull();
    expect(fsApi.rmdir).toHaveBeenCalled();
    expect(fsApi.unlink).toHaveBeenCalled();
  });
});
