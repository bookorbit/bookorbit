vi.mock('fs/promises', () => ({
  mkdir: vi.fn(),
  writeFile: vi.fn(),
}));

vi.mock('../metadata/lib/cover', () => ({
  generateThumbnail: vi.fn(),
  imageExt: vi.fn(),
}));

import { Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'fs/promises';
import type { ParsedBookData } from '../metadata/extractors/format-extractor.interface';
import { generateThumbnail, imageExt } from '../metadata/lib/cover';
import { BookDockMetadataService } from './book-dock-metadata.service';

const mockMkdir = vi.mocked(mkdir);
const mockWriteFile = vi.mocked(writeFile);
const mockGenerateThumbnail = vi.mocked(generateThumbnail);
const mockImageExt = vi.mocked(imageExt);

const richMetadata: ParsedBookData = {
  title: 'Dune',
  subtitle: 'Deluxe Edition',
  description: 'A desert planet.',
  isbn10: '0441172717',
  isbn13: '9780441172719',
  publisher: 'Ace',
  publishedDate: '1965-08-01',
  publishedYear: 1965,
  language: 'en',
  seriesName: 'Dune',
  seriesIndex: 1,
  authors: [{ name: 'Frank Herbert', sortName: 'Herbert, Frank' }],
  genres: ['Science Fiction'],
  googleBooksId: 'google-id',
  goodreadsId: 'goodreads-id',
  amazonId: 'amazon-id',
  hardcoverId: 'hardcover-book',
  hardcoverEditionId: 'hardcover-edition',
  openLibraryId: 'OL1W',
  itunesId: 'itunes-id',
  audibleId: 'audible-id',
  librofmId: 'librofm-id',
  koboId: 'kobo-id',
  ranobedbId: 'ranobedb-id',
  lubimyczytacId: 'lubimyczytac-id',
  aladinId: 'aladin-id',
  narrators: ['Simon Vance'],
  durationSeconds: 1200,
  chapters: [{ title: 'Chapter 1', startMs: 0 }],
  pageCount: 688,
  comicMetadata: {
    issueNumber: '1',
    volumeName: null,
    pencillers: ['Artist'],
    inkers: [],
    colorists: [],
    letterers: [],
    coverArtists: [],
    characters: [],
    teams: [],
    locations: [],
    storyArcs: [],
  },
  cover: Buffer.from('cover-bytes'),
};

function makeService() {
  const repo = {
    update: vi.fn().mockResolvedValue(undefined),
  };
  const extractionService = {
    extractWithCoverFallback: vi.fn().mockResolvedValue({
      metadata: richMetadata,
      cover: richMetadata.cover,
    }),
  };
  const service = new BookDockMetadataService(repo as never, extractionService as never);
  return { service, repo, extractionService };
}

describe('BookDockMetadataService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMkdir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
    mockGenerateThumbnail.mockResolvedValue(Buffer.from('thumbnail-bytes'));
    mockImageExt.mockReturnValue('jpg');
  });

  it('adapts the canonical extraction result without dropping supported metadata', async () => {
    const { service, repo, extractionService } = makeService();

    await service.extractAndSave(7, '/incoming/dune.epub', 'epub', '/book-dock/covers');

    expect(extractionService.extractWithCoverFallback).toHaveBeenCalledOnce();
    expect(extractionService.extractWithCoverFallback).toHaveBeenCalledWith('/incoming/dune.epub', 'epub');
    expect(repo.update).toHaveBeenNthCalledWith(1, 7, { status: 'extracting' });
    expect(repo.update).toHaveBeenNthCalledWith(2, 7, {
      embeddedMetadata: {
        title: 'Dune',
        subtitle: 'Deluxe Edition',
        description: 'A desert planet.',
        publisher: 'Ace',
        publishedDate: '1965-08-01',
        publishedYear: 1965,
        language: 'en',
        isbn10: '0441172717',
        isbn13: '9780441172719',
        seriesName: 'Dune',
        seriesIndex: 1,
        pageCount: 688,
        authors: ['Frank Herbert'],
        genres: ['Science Fiction'],
        narrators: ['Simon Vance'],
        durationSeconds: 1200,
        chapters: [{ title: 'Chapter 1', startMs: 0 }],
        googleBooksId: 'google-id',
        goodreadsId: 'goodreads-id',
        amazonId: 'amazon-id',
        hardcoverId: 'hardcover-book',
        hardcoverEditionId: 'hardcover-edition',
        openLibraryId: 'OL1W',
        itunesId: 'itunes-id',
        audibleId: 'audible-id',
        librofmId: 'librofm-id',
        koboId: 'kobo-id',
        ranobedbId: 'ranobedb-id',
        lubimyczytacId: 'lubimyczytac-id',
        aladinId: 'aladin-id',
        comicMetadata: { issueNumber: '1', pencillers: ['Artist'] },
      },
      coverPath: '/book-dock/covers/7.jpg',
      status: 'ready',
    });
    expect(mockMkdir).toHaveBeenCalledWith('/book-dock/covers', { recursive: true });
    expect(mockWriteFile).toHaveBeenCalledWith('/book-dock/covers/7.jpg', Buffer.from('cover-bytes'));
    expect(mockWriteFile).toHaveBeenCalledWith('/book-dock/covers/7_thumb.jpg', Buffer.from('thumbnail-bytes'));
  });

  it('stores an empty ready result when the canonical extractor has no metadata', async () => {
    const { service, repo, extractionService } = makeService();
    extractionService.extractWithCoverFallback.mockResolvedValue({ metadata: null, cover: null });

    await service.extractAndSave(8, '/incoming/unknown.bin', 'unknown', '/book-dock/covers');

    expect(repo.update).toHaveBeenNthCalledWith(2, 8, {
      embeddedMetadata: {},
      coverPath: null,
      status: 'ready',
    });
    expect(mockMkdir).not.toHaveBeenCalled();
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('omits null and empty canonical fields from staging metadata', async () => {
    const { service, repo, extractionService } = makeService();
    extractionService.extractWithCoverFallback.mockResolvedValue({
      metadata: {
        title: null,
        authors: [],
        genres: [],
        narrators: [],
        chapters: [],
        hardcoverId: null,
        comicMetadata: null,
        cover: null,
      },
      cover: null,
    });

    await service.extractAndSave(9, '/incoming/empty.epub', 'epub', '/book-dock/covers');

    expect(repo.update).toHaveBeenNthCalledWith(2, 9, {
      embeddedMetadata: expect.objectContaining({
        title: undefined,
        authors: undefined,
        genres: undefined,
        narrators: undefined,
        chapters: undefined,
      }),
      coverPath: null,
      status: 'ready',
    });
  });

  it('marks the staging row as failed when centralized extraction throws', async () => {
    const { service, repo, extractionService } = makeService();
    const warnSpy = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    extractionService.extractWithCoverFallback.mockRejectedValue(new TypeError('parser failed'));

    await service.extractAndSave(10, '/incoming/bad.pdf', 'pdf', '/book-dock/covers');

    expect(repo.update).toHaveBeenNthCalledWith(2, 10, {
      status: 'error',
      errorMessage: 'parser failed',
    });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('errorClass=TypeError'));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('error="parser failed"'));
  });

  it('marks the staging row as failed when cover persistence throws', async () => {
    const { service, repo } = makeService();
    mockWriteFile.mockRejectedValueOnce(new Error('disk full'));

    await service.extractAndSave(11, '/incoming/dune.epub', 'epub', '/book-dock/covers');

    expect(repo.update).toHaveBeenNthCalledWith(2, 11, {
      status: 'error',
      errorMessage: 'disk full',
    });
  });
});
