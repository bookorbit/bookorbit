vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('../metadata/lib/pdf-parser', () => ({
  parsePdfFile: vi.fn(),
}));

vi.mock('../metadata/lib/cover', () => ({
  extractCover: vi.fn(),
  generateThumbnail: vi.fn(),
  imageExt: vi.fn(),
}));

import { mkdir, writeFile } from 'fs/promises';
import type { MockedFunction } from 'vitest';

import { extractCover, generateThumbnail, imageExt } from '../metadata/lib/cover';
import { parsePdfFile } from '../metadata/lib/pdf-parser';
import { BookBucketMetadataService } from './book-bucket-metadata.service';

const mockMkdir = mkdir as MockedFunction<typeof mkdir>;
const mockWriteFile = writeFile as MockedFunction<typeof writeFile>;
const mockExtractCover = extractCover as MockedFunction<typeof extractCover>;
const mockGenerateThumbnail = generateThumbnail as MockedFunction<typeof generateThumbnail>;
const mockImageExt = imageExt as MockedFunction<typeof imageExt>;
const mockParsePdfFile = parsePdfFile as MockedFunction<typeof parsePdfFile>;

describe('BookBucketMetadataService', () => {
  const repo = {
    update: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.resetAllMocks();
    repo.update.mockResolvedValue(undefined);
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockExtractCover.mockResolvedValue(null);
    mockGenerateThumbnail.mockResolvedValue(Buffer.from('thumb'));
    mockImageExt.mockReturnValue('png');
    mockParsePdfFile.mockResolvedValue(null);
  });

  it('extractAndSave(pdf) reuses a single parse result for metadata and cover persistence', async () => {
    mockParsePdfFile.mockResolvedValue({
      title: 'PDF Title',
      subtitle: null,
      description: null,
      publisher: 'PDF Publisher',
      publishedYear: null,
      language: null,
      authors: [{ name: 'Author A', sortName: null }],
      genres: ['Genre A'],
      tags: [],
      isbn10: null,
      isbn13: null,
      seriesName: null,
      seriesIndex: null,
      rating: null,
      pageCount: 200,
      googleBooksId: null,
      goodreadsId: null,
      amazonId: null,
      hardcoverId: null,
      openLibraryId: null,
      itunesId: null,
      coverBuffer: Buffer.from('cover'),
    });

    const service = new BookBucketMetadataService(repo as never);

    await service.extractAndSave(5, '/tmp/book.pdf', 'pdf', '/tmp/covers');

    expect(mockParsePdfFile).toHaveBeenCalledTimes(1);
    expect(mockParsePdfFile).toHaveBeenCalledWith(
      '/tmp/book.pdf',
      expect.objectContaining({
        extractCover: true,
        onWarning: expect.any(Function),
      }),
    );
    expect(mockExtractCover).not.toHaveBeenCalled();
    expect(repo.update).toHaveBeenNthCalledWith(1, 5, { status: 'extracting' });
    expect(repo.update).toHaveBeenNthCalledWith(2, 5, {
      embeddedMetadata: {
        title: 'PDF Title',
        publisher: 'PDF Publisher',
        pageCount: 200,
        authors: ['Author A'],
        genres: ['Genre A'],
      },
      coverPath: '/tmp/covers/5.png',
      status: 'ready',
    });
    expect(mockMkdir).toHaveBeenCalledWith('/tmp/covers', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith('/tmp/covers/5.png', Buffer.from('cover'));
    expect(mockWriteFile).toHaveBeenCalledWith('/tmp/covers/5_thumb.jpg', Buffer.from('thumb'));
  });

  it('extractAndSave(pdf) leaves coverPath null when no cover bytes are available', async () => {
    mockParsePdfFile.mockResolvedValue({
      title: 'PDF Title',
      subtitle: null,
      description: null,
      publisher: null,
      publishedYear: null,
      language: null,
      authors: [],
      genres: [],
      tags: [],
      isbn10: null,
      isbn13: null,
      seriesName: null,
      seriesIndex: null,
      rating: null,
      pageCount: 12,
      googleBooksId: null,
      goodreadsId: null,
      amazonId: null,
      hardcoverId: null,
      openLibraryId: null,
      itunesId: null,
      coverBuffer: null,
    });

    const service = new BookBucketMetadataService(repo as never);

    await service.extractAndSave(6, '/tmp/book.pdf', 'pdf', '/tmp/covers');

    expect(repo.update).toHaveBeenNthCalledWith(2, 6, {
      embeddedMetadata: {
        title: 'PDF Title',
        publisher: undefined,
        pageCount: 12,
        authors: undefined,
        genres: undefined,
      },
      coverPath: null,
      status: 'ready',
    });
    expect(mockWriteFile).not.toHaveBeenCalled();
  });
});
