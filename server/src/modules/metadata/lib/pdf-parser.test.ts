vi.mock('fs/promises', () => ({
  mkdtemp: vi.fn(),
  readFile: vi.fn(),
  readdir: vi.fn(),
  rm: vi.fn(),
}));

vi.mock('child_process', () => ({ execFile: vi.fn() }));

vi.mock('pdf-lib', () => ({
  PDFDocument: {
    load: vi.fn(),
  },
}));

vi.mock('./pdf-xmp-reader', () => ({
  extractXmpXml: vi.fn(),
  parseXmp: vi.fn(),
}));

import { execFile } from 'child_process';
import { mkdtemp, readFile, readdir, rm } from 'fs/promises';
import { PDFDocument } from 'pdf-lib';

import { extractXmpXml, parseXmp } from './pdf-xmp-reader';
import { parsePdfFile } from './pdf-parser';

const mockExecFile = execFile as unknown as vi.Mock;
const mockMkdtemp = mkdtemp as MockedFunction<typeof mkdtemp>;
const mockReadFile = readFile as MockedFunction<typeof readFile>;
const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockRm = rm as MockedFunction<typeof rm>;
const mockPdfLoad = PDFDocument.load as vi.Mock;
const mockExtractXmpXml = extractXmpXml as MockedFunction<typeof extractXmpXml>;
const mockParseXmp = parseXmp as MockedFunction<typeof parseXmp>;

function mockExecSuccess() {
  mockExecFile.mockImplementation((_file: string, _args: string[], cb: (err: Error | null, stdout?: string, stderr?: string) => void) => {
    cb(null, '', '');
  });
}

describe('parsePdfFile', () => {
  beforeEach(() => {
    vi.resetAllMocks();

    mockMkdtemp.mockResolvedValue('/tmp/pdf-cover-1');
    mockReaddir.mockResolvedValue(['cover-1.jpg'] as unknown as Awaited<ReturnType<typeof readdir>>);
    mockRm.mockResolvedValue(undefined);
    mockReadFile
      .mockResolvedValueOnce(Buffer.from('%PDF-1.7') as unknown as Awaited<ReturnType<typeof readFile>>)
      .mockResolvedValueOnce(Buffer.from([0xff, 0xd8, 0xff]) as unknown as Awaited<ReturnType<typeof readFile>>);

    mockPdfLoad.mockResolvedValue({
      getTitle: () => 'Info Title',
      getAuthor: () => 'Author One; Author Two',
      getSubject: () => 'Info Subject',
      getKeywords: () => 'tag1, tag2',
      getPageCount: () => 123,
    });

    mockExecSuccess();
  });

  it('prefers XMP metadata when available and still includes extracted cover/pageCount', async () => {
    mockExtractXmpXml.mockReturnValue('<xmp/>');
    mockParseXmp.mockReturnValue({
      title: 'XMP Title',
      subtitle: 'XMP Subtitle',
      description: 'XMP Description',
      publisher: 'XMP Publisher',
      publishedYear: 2001,
      language: 'en',
      authors: [{ name: 'XMP Author', sortName: null }],
      genres: ['Sci-Fi'],
      tags: ['favorite'],
      isbn10: '0123456789',
      isbn13: '9780123456789',
      seriesName: 'Series',
      seriesIndex: 2,
      rating: 4.5,
      pageCount: 999,
      googleBooksId: 'g1',
      goodreadsId: 'gr1',
      amazonId: 'a1',
      hardcoverId: 'h1',
      openLibraryId: 'ol1',
    });

    const parsed = await parsePdfFile('/books/book.pdf');

    expect(parsed).toEqual(
      expect.objectContaining({
        title: 'XMP Title',
        authors: [{ name: 'XMP Author', sortName: null }],
        tags: ['favorite'],
        pageCount: 999,
        coverBuffer: Buffer.from([0xff, 0xd8, 0xff]),
      }),
    );
  });

  it('falls back to Info dictionary fields when no XMP is present', async () => {
    mockExtractXmpXml.mockReturnValue(null);

    const parsed = await parsePdfFile('/books/book.pdf');

    expect(parsed).toEqual(
      expect.objectContaining({
        title: 'Info Title',
        authors: [
          { name: 'Author One', sortName: null },
          { name: 'Author Two', sortName: null },
        ],
        description: 'Info Subject',
        tags: ['tag1', 'tag2'],
      }),
    );
  });

  it('returns null coverBuffer when pdftoppm command fails, but still returns metadata', async () => {
    mockExtractXmpXml.mockReturnValue(null);
    mockExecFile.mockImplementation((_file: string, _args: string[], cb: (err: Error | null) => void) => cb(new Error('pdftoppm missing')));

    const parsed = await parsePdfFile('/books/book.pdf');

    expect(parsed).toEqual(expect.objectContaining({ title: 'Info Title', coverBuffer: null }));
    expect(mockRm).toHaveBeenCalledWith('/tmp/pdf-cover-1', { recursive: true, force: true });
  });

  it('returns null when PDF cannot be parsed', async () => {
    mockPdfLoad.mockRejectedValue(new Error('invalid pdf'));

    await expect(parsePdfFile('/books/bad.pdf')).resolves.toBeNull();
  });
});
