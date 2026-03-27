vi.mock('fs/promises');
vi.mock('./cover-epub', () => ({ extractEpubCover: vi.fn() }));
vi.mock('./cover-cbz', () => ({ extractCbzCover: vi.fn() }));
vi.mock('./cover-cbr', () => ({ extractCbrCover: vi.fn() }));
vi.mock('./cover-cb7', () => ({ extractCb7Cover: vi.fn() }));
vi.mock('./cover-fb2', () => ({ extractFb2Cover: vi.fn() }));
vi.mock('./mobi-parser', () => ({ extractMobiCover: vi.fn() }));
vi.mock('sharp', () => {
  const chain = {
    resize: vi.fn(),
    jpeg: vi.fn(),
    toBuffer: vi.fn().mockResolvedValue(Buffer.from('thumbnail')),
  };
  chain.resize.mockReturnValue(chain);
  chain.jpeg.mockReturnValue(chain);
  const mockFn = vi.fn().mockReturnValue(chain);
  return { __esModule: true, default: mockFn };
});

import { mkdir, readFile, readdir, writeFile } from 'fs/promises';
import { join } from 'path';
import sharp from 'sharp';
import { extractCb7Cover } from './cover-cb7';
import { extractCbrCover } from './cover-cbr';
import { extractCbzCover } from './cover-cbz';
import { extractEpubCover } from './cover-epub';
import { extractFb2Cover } from './cover-fb2';
import { extractMobiCover } from './mobi-parser';
import { coverDirPath, extractAndSaveCover, extractCover, generateThumbnail, imageExt } from './cover';

const mockMkdir = mkdir as MockedFunction<typeof mkdir>;
const mockReadFile = readFile as MockedFunction<typeof readFile>;
const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockWriteFile = writeFile as MockedFunction<typeof writeFile>;
const mockEpub = extractEpubCover as MockedFunction<typeof extractEpubCover>;
const mockMobi = extractMobiCover as MockedFunction<typeof extractMobiCover>;
const mockCbz = extractCbzCover as MockedFunction<typeof extractCbzCover>;
const mockCbr = extractCbrCover as MockedFunction<typeof extractCbrCover>;
const mockCb7 = extractCb7Cover as MockedFunction<typeof extractCb7Cover>;
const mockFb2 = extractFb2Cover as MockedFunction<typeof extractFb2Cover>;

const JPEG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

beforeEach(() => {
  vi.clearAllMocks();
  // Reset format extractor mocks to return null by default
  mockEpub.mockResolvedValue(null);
  mockMobi.mockResolvedValue(null);
  mockCbz.mockResolvedValue(null);
  mockCbr.mockResolvedValue(null);
  mockCb7.mockResolvedValue(null);
  mockFb2.mockResolvedValue(null);
  // fs mocks
  mockMkdir.mockResolvedValue(undefined);
  mockWriteFile.mockResolvedValue(undefined);
  mockReaddir.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof readdir>>);
  mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
});

// ── imageExt ──────────────────────────────────────────────────────────────────

describe('imageExt', () => {
  it('returns "png" for PNG magic bytes (0x89 0x50)', () => {
    expect(imageExt(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('png');
  });

  it('returns "jpg" for JPEG magic bytes (0xFF 0xD8)', () => {
    expect(imageExt(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('jpg');
  });

  it('returns "jpg" as default for unknown magic bytes (GIF)', () => {
    expect(imageExt(Buffer.from([0x47, 0x49, 0x46, 0x38]))).toBe('jpg');
  });

  it('returns "jpg" when first byte is 0x89 but second byte is not 0x50', () => {
    expect(imageExt(Buffer.from([0x89, 0x51, 0x00, 0x00]))).toBe('jpg');
  });

  it('does not throw on a single-byte buffer', () => {
    expect(imageExt(Buffer.from([0x89]))).toBe('jpg');
  });
});

// ── coverDirPath ──────────────────────────────────────────────────────────────

describe('coverDirPath', () => {
  it('returns path under booksPath/covers/<bookId>', () => {
    expect(coverDirPath('/data/books', 42)).toBe(join('/data/books', 'covers', '42'));
  });

  it('stringifies numeric bookId', () => {
    expect(coverDirPath('/data/books', 100)).toContain('100');
  });
});

// ── generateThumbnail ─────────────────────────────────────────────────────────

describe('generateThumbnail', () => {
  it('returns a Buffer', async () => {
    const result = await generateThumbnail(JPEG_BYTES);
    expect(result).toBeInstanceOf(Buffer);
  });

  it('resizes with inside-fit to avoid cropping', async () => {
    await generateThumbnail(JPEG_BYTES);
    const sharpMock = sharp as unknown as MockedFunction<typeof sharp>;
    expect(sharpMock).toHaveBeenCalledWith(JPEG_BYTES);
    const chain = sharpMock.mock.results[0]?.value as { resize: Mock };
    expect(chain.resize).toHaveBeenCalledWith(400, 600, { fit: 'inside', withoutEnlargement: true });
  });
});

// ── extractCover (routing) ────────────────────────────────────────────────────

describe('extractCover', () => {
  it('routes epub to extractEpubCover', async () => {
    mockEpub.mockResolvedValue(JPEG_BYTES);
    const result = await extractCover('/book.epub', 'epub');
    expect(mockEpub).toHaveBeenCalledWith('/book.epub');
    expect(result).toBe(JPEG_BYTES);
  });

  it('routes mobi to extractMobiCover', async () => {
    mockMobi.mockResolvedValue(JPEG_BYTES);
    await extractCover('/book.mobi', 'mobi');
    expect(mockMobi).toHaveBeenCalledWith('/book.mobi');
  });

  it('routes azw3 to extractMobiCover', async () => {
    mockMobi.mockResolvedValue(JPEG_BYTES);
    await extractCover('/book.azw3', 'azw3');
    expect(mockMobi).toHaveBeenCalledWith('/book.azw3');
  });

  it('routes azw to extractMobiCover', async () => {
    mockMobi.mockResolvedValue(JPEG_BYTES);
    await extractCover('/book.azw', 'azw');
    expect(mockMobi).toHaveBeenCalledWith('/book.azw');
  });

  it('routes cbz to extractCbzCover', async () => {
    mockCbz.mockResolvedValue(JPEG_BYTES);
    await extractCover('/book.cbz', 'cbz');
    expect(mockCbz).toHaveBeenCalledWith('/book.cbz');
  });

  it('routes cbr to extractCbrCover', async () => {
    mockCbr.mockResolvedValue(JPEG_BYTES);
    await extractCover('/book.cbr', 'cbr');
    expect(mockCbr).toHaveBeenCalledWith('/book.cbr');
  });

  it('routes cb7 to extractCb7Cover', async () => {
    mockCb7.mockResolvedValue(JPEG_BYTES);
    await extractCover('/book.cb7', 'cb7');
    expect(mockCb7).toHaveBeenCalledWith('/book.cb7');
  });

  it('routes fb2 to extractFb2Cover', async () => {
    mockFb2.mockResolvedValue(JPEG_BYTES);
    await extractCover('/book.fb2', 'fb2');
    expect(mockFb2).toHaveBeenCalledWith('/book.fb2');
  });

  it('returns null for unsupported format', async () => {
    expect(await extractCover('/book.pdf', 'pdf')).toBeNull();
  });

  it('format matching is case-insensitive', async () => {
    mockEpub.mockResolvedValue(JPEG_BYTES);
    await extractCover('/book.epub', 'EPUB');
    expect(mockEpub).toHaveBeenCalled();
  });
});

// ── extractAndSaveCover ───────────────────────────────────────────────────────

describe('extractAndSaveCover', () => {
  it('returns null when extractor and sidecar both produce nothing', async () => {
    mockEpub.mockResolvedValue(null);
    const result = await extractAndSaveCover('/books/book.epub', 'epub', 1, '/booksPath');
    expect(result).toBeNull();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('saves extracted cover and returns file path', async () => {
    mockEpub.mockResolvedValue(JPEG_BYTES);
    const result = await extractAndSaveCover('/books/book.epub', 'epub', 42, '/booksPath');
    expect(mockMkdir).toHaveBeenCalledWith(expect.stringContaining('42'), { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining('cover_extracted.jpg'), JPEG_BYTES);
    expect(result).toContain('cover_extracted.jpg');
  });

  it('uses png extension for PNG magic bytes', async () => {
    mockEpub.mockResolvedValue(PNG_BYTES);
    const result = await extractAndSaveCover('/books/book.epub', 'epub', 1, '/booksPath');
    expect(result).toContain('cover_extracted.png');
  });

  it('falls back to sidecar cover when extractor returns null', async () => {
    mockEpub.mockResolvedValue(null);
    mockReadFile.mockResolvedValue(PNG_BYTES as unknown as Awaited<ReturnType<typeof readFile>>);
    const result = await extractAndSaveCover('/books/book.epub', 'epub', 5, '/booksPath');
    expect(result).toContain('cover_extracted.png');
    expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining('cover_extracted.png'), PNG_BYTES);
  });

  it('falls back to sidecar when extractor returns empty buffer', async () => {
    mockEpub.mockResolvedValue(Buffer.alloc(0));
    mockReadFile.mockResolvedValue(JPEG_BYTES as unknown as Awaited<ReturnType<typeof readFile>>);
    const result = await extractAndSaveCover('/books/book.epub', 'epub', 5, '/booksPath');
    expect(result).not.toBeNull();
  });

  it('generates thumbnail when no custom cover exists', async () => {
    mockEpub.mockResolvedValue(JPEG_BYTES);
    mockReaddir.mockResolvedValue(['cover_extracted.jpg'] as unknown as Awaited<ReturnType<typeof readdir>>);
    await extractAndSaveCover('/books/book.epub', 'epub', 1, '/booksPath');
    // Two writes: extracted cover + thumbnail
    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    expect(mockWriteFile).toHaveBeenCalledWith(expect.stringContaining('thumbnail.jpg'), expect.any(Buffer));
  });

  it('skips thumbnail when a custom cover file already exists', async () => {
    mockEpub.mockResolvedValue(JPEG_BYTES);
    mockReaddir.mockResolvedValue(['cover_custom.jpg'] as unknown as Awaited<ReturnType<typeof readdir>>);
    await extractAndSaveCover('/books/book.epub', 'epub', 1, '/booksPath');
    // Only one write: extracted cover; no thumbnail
    expect(mockWriteFile).toHaveBeenCalledTimes(1);
    expect(mockWriteFile).not.toHaveBeenCalledWith(expect.stringContaining('thumbnail'), expect.anything());
  });
});
