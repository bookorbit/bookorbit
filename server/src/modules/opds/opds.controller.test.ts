vi.mock('fs', () => ({
  createReadStream: vi.fn(),
}));

vi.mock('fs/promises', () => ({
  readdir: vi.fn(),
  stat: vi.fn(),
}));

import { createReadStream } from 'fs';
import { readdir, stat } from 'fs/promises';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { MockedFunction } from 'vitest';

import { OpdsController } from './opds.controller';

const mockCreateReadStream = createReadStream as MockedFunction<typeof createReadStream>;
const mockReaddir = readdir as MockedFunction<typeof readdir>;
const mockStat = stat as MockedFunction<typeof stat>;

function makeController() {
  const opdsService = {
    generateRootNavigation: vi.fn().mockReturnValue('<root />'),
    generateLibrariesNavigation: vi.fn().mockReturnValue('<libraries />'),
    generateCollectionsNavigation: vi.fn().mockReturnValue('<collections />'),
    generateLensesNavigation: vi.fn().mockReturnValue('<lenses />'),
    generateAuthorsNavigation: vi.fn().mockReturnValue('<authors />'),
    generateSeriesNavigation: vi.fn().mockReturnValue('<series />'),
    generateAcquisitionFeed: vi.fn().mockReturnValue('<feed />'),
    generateOpenSearchDescription: vi.fn().mockReturnValue('<search />'),
  } as never;
  const opdsBookService = {
    getAccessibleLibraries: vi.fn().mockResolvedValue([{ id: 1, name: 'Main', bookCount: 10 }]),
    getUserCollections: vi.fn().mockResolvedValue([{ id: 4, name: 'Favorites', bookCount: 2 }]),
    getUserLenses: vi.fn().mockResolvedValue([{ id: 7, name: 'Unread', icon: 'sparkles' }]),
    getDistinctAuthors: vi.fn().mockResolvedValue([{ name: 'Frank Herbert', bookCount: 3 }]),
    getDistinctSeries: vi.fn().mockResolvedValue([
      { name: null, bookCount: 1 },
      { name: 'Dune', bookCount: 2 },
    ]),
    getBooksPage: vi.fn().mockResolvedValue({ entries: [{ id: 1 }], total: 1 }),
    getRecentBooksPage: vi.fn().mockResolvedValue({ entries: [{ id: 2 }], total: 1 }),
    getRandomBooks: vi.fn().mockResolvedValue([{ id: 3 }]),
    validateBookAccess: vi.fn().mockResolvedValue(undefined),
    getBookFiles: vi.fn().mockResolvedValue({
      absolutePath: '/books/library/book.epub',
      format: 'epub',
      title: 'Book Title',
      authorName: 'Author Name',
    }),
  } as never;
  const config = {
    get: vi.fn().mockReturnValue('/books'),
  } as never;

  return {
    controller: new OpdsController(opdsService, opdsBookService, config),
    opdsService,
    opdsBookService,
  };
}

function makeReply() {
  const reply = {
    header: vi.fn(),
    type: vi.fn(),
    status: vi.fn(),
    send: vi.fn(),
  };

  reply.header.mockReturnValue(reply);
  reply.type.mockReturnValue(reply);
  reply.status.mockReturnValue(reply);

  return reply as never;
}

describe('OpdsController', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('renders root navigation feed', () => {
    const { controller, opdsService } = makeController();
    const reply = makeReply();

    controller.root({} as never, reply);

    expect(opdsService.generateRootNavigation).toHaveBeenCalledOnce();
    expect(reply.type).toHaveBeenCalledWith('application/atom+xml;profile=opds-catalog;kind=navigation; charset=utf-8');
    expect(reply.send).toHaveBeenCalledWith('<root />');
  });

  it('renders navigation endpoints with OPDS navigation mime type', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const user = { userId: 8, isSuperuser: false } as never;

    await controller.libraries(user, makeReply());
    await controller.collections(user, makeReply());
    await controller.lenses(user, makeReply());
    await controller.authors(user, makeReply());
    await controller.series(user, makeReply());

    expect(opdsBookService.getAccessibleLibraries).toHaveBeenCalledWith(8, false);
    expect(opdsBookService.getUserCollections).toHaveBeenCalledWith(8);
    expect(opdsBookService.getUserLenses).toHaveBeenCalledWith(8);
    expect(opdsBookService.getDistinctAuthors).toHaveBeenCalledWith(8, false);
    expect(opdsBookService.getDistinctSeries).toHaveBeenCalledWith(8, false);
    expect(opdsService.generateSeriesNavigation).toHaveBeenCalledWith([{ name: 'Dune', bookCount: 2 }]);
  });

  it('catalog clamps pagination and passes parsed filters to the book service', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const reply = makeReply();
    const user = { userId: 7, isSuperuser: true, sortOrder: 'author_desc', coverToken: 'token' } as never;

    await controller.catalog(user, -4, 500, '2', '11', '15', 'Frank Herbert', 'Dune', 'arrakis', reply);

    expect(opdsBookService.getBooksPage).toHaveBeenCalledWith(
      7,
      'author_desc',
      1,
      100,
      {
        libraryId: 2,
        collectionId: 11,
        lensId: 15,
        author: 'Frank Herbert',
        series: 'Dune',
        q: 'arrakis',
      },
      true,
    );
    expect(opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      'Search: arrakis',
      'urn:projectx:catalog',
      [{ id: 1 }],
      1,
      1,
      100,
      expect.stringContaining('/api/v1/opds/catalog?'),
      'token',
    );
  });

  it('rejects invalid catalog filter ids and deep pagination windows', async () => {
    const { controller } = makeController();
    const user = { userId: 7, isSuperuser: false, sortOrder: 'recent', coverToken: 'token' } as never;
    const reply = makeReply();

    await expect(controller.catalog(user, 1, 50, 'abc', undefined, undefined, undefined, undefined, undefined, reply)).rejects.toThrow(
      BadRequestException,
    );
    await expect(controller.catalog(user, 1_000_000, 100, undefined, undefined, undefined, undefined, undefined, undefined, reply)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('renders recent and surprise acquisition feeds', async () => {
    const { controller, opdsBookService, opdsService } = makeController();
    const user = { userId: 12, isSuperuser: false, coverToken: 'cover-token' } as never;

    await controller.recent(user, 0, 1000, makeReply());
    await controller.surprise(user, makeReply());

    expect(opdsBookService.getRecentBooksPage).toHaveBeenCalledWith(12, 1, 100, false);
    expect(opdsBookService.getRandomBooks).toHaveBeenCalledWith(12, 25, false);
    expect(opdsService.generateAcquisitionFeed).toHaveBeenCalledWith(
      'Random Books',
      'urn:projectx:surprise',
      [{ id: 3 }],
      1,
      1,
      25,
      '/api/v1/opds/surprise',
      'cover-token',
    );
  });

  it('returns OpenSearch description with OPDS search mime type', () => {
    const { controller } = makeController();
    const reply = makeReply();

    controller.searchDescription({} as never, reply);

    expect(reply.type).toHaveBeenCalledWith('application/opensearchdescription+xml; charset=utf-8');
    expect(reply.send).toHaveBeenCalledWith('<search />');
  });

  it('serves the preferred stored cover file for OPDS clients', async () => {
    const { controller, opdsBookService } = makeController();
    const reply = makeReply();
    const stream = { kind: 'stream' };

    mockReaddir.mockResolvedValue(['cover_extracted.jpg', 'cover_custom.png'] as never);
    mockStat.mockResolvedValue({ mtimeMs: 1234 } as never);
    mockCreateReadStream.mockReturnValue(stream as never);

    await controller.cover(42, { userId: 7, isSuperuser: false } as never, reply);

    expect(opdsBookService.validateBookAccess).toHaveBeenCalledWith(42, 7, false);
    expect(reply.header).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    expect(mockCreateReadStream).toHaveBeenCalledWith('/books/covers/42/cover_custom.png');
    expect(reply.header).toHaveBeenCalledWith('ETag', '"1234"');
    expect(reply.type).toHaveBeenCalledWith('image/png');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('returns 304 when cover ETag matches If-None-Match', async () => {
    const { controller } = makeController();
    const reply = makeReply();

    mockReaddir.mockResolvedValue(['cover_custom.jpg'] as never);
    mockStat.mockResolvedValue({ mtimeMs: 5000 } as never);

    await controller.cover(42, { userId: 7, isSuperuser: false } as never, reply, '"5000"');

    expect(reply.header).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    expect(reply.status).toHaveBeenCalledWith(304);
    expect(reply.send).toHaveBeenCalledWith();
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when no cover exists', async () => {
    const { controller } = makeController();
    mockReaddir.mockRejectedValue(new Error('missing dir'));

    await expect(controller.cover(42, { userId: 7, isSuperuser: false } as never, makeReply())).rejects.toThrow(NotFoundException);
  });

  it('serves thumbnail image when available', async () => {
    const { controller } = makeController();
    const reply = makeReply();
    const stream = { kind: 'thumbnail-stream' };

    mockStat.mockResolvedValue({ mtimeMs: 2222 } as never);
    mockCreateReadStream.mockReturnValue(stream as never);

    await controller.thumbnail(12, { userId: 1, isSuperuser: false } as never, reply);

    expect(reply.header).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    expect(reply.type).toHaveBeenCalledWith('image/jpeg');
    expect(reply.header).toHaveBeenCalledWith('ETag', '"2222"');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('returns 304 for thumbnail when ETag matches', async () => {
    const { controller } = makeController();
    const reply = makeReply();

    mockStat.mockResolvedValue({ mtimeMs: 3333 } as never);

    await controller.thumbnail(12, { userId: 1, isSuperuser: false } as never, reply, '"3333"');

    expect(reply.header).toHaveBeenCalledWith('Cross-Origin-Resource-Policy', 'cross-origin');
    expect(reply.status).toHaveBeenCalledWith(304);
    expect(reply.send).toHaveBeenCalledWith();
    expect(mockCreateReadStream).not.toHaveBeenCalled();
  });

  it('throws NotFoundException when thumbnail file is missing', async () => {
    const { controller } = makeController();
    mockStat.mockRejectedValue(new Error('missing thumbnail'));

    await expect(controller.thumbnail(42, { userId: 7, isSuperuser: false } as never, makeReply())).rejects.toThrow(NotFoundException);
  });

  it('downloads file with sanitized attachment name', async () => {
    const { controller, opdsBookService } = makeController();
    const reply = makeReply();
    const stream = { kind: 'download-stream' };

    opdsBookService.getBookFiles.mockResolvedValue({
      absolutePath: '/books/library/book.epub',
      format: 'epub',
      title: 'Bad:/Title*',
      authorName: 'Au<th>or',
    });
    mockStat.mockResolvedValue({ size: 12345 } as never);
    mockCreateReadStream.mockReturnValue(stream as never);

    await controller.download(99, 0, { userId: 2, isSuperuser: false } as never, reply);

    expect(reply.header).toHaveBeenCalledWith('Content-Disposition', 'attachment; filename="BadTitle - Author.epub"');
    expect(reply.header).toHaveBeenCalledWith('Content-Length', 12345);
    expect(reply.type).toHaveBeenCalledWith('application/epub+zip');
    expect(reply.send).toHaveBeenCalledWith(stream);
  });

  it('throws NotFoundException when requested download file is unavailable', async () => {
    const { controller, opdsBookService } = makeController();
    opdsBookService.getBookFiles.mockResolvedValue(null);

    await expect(controller.download(88, 77, { userId: 2, isSuperuser: false } as never, makeReply())).rejects.toThrow(NotFoundException);
  });
});
