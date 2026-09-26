import { BadRequestException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { EMPTY_CONTENT_FILTER_RULES, Permission } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import { PermissionService } from '../../common/services/permission.service';
import { WatchDownloadService } from './watch-download.service';

function makeUser(): RequestUser {
  return {
    id: 7,
    username: 'watch-user',
    name: 'Watch User',
    email: null,
    active: true,
    isSuperuser: false,
    isDefaultPassword: false,
    tokenVersion: 3,
    authenticationMethod: 'password',
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    permissions: [Permission.LibraryDownload],
    contentFilters: EMPTY_CONTENT_FILTER_RULES,
  };
}

function makeService() {
  const user = makeUser();
  const jwt = {
    signAsync: vi.fn().mockResolvedValue('watch-ticket'),
    verifyAsync: vi.fn().mockResolvedValue({
      sub: String(user.id),
      ver: user.tokenVersion,
      amr: user.authenticationMethod,
      bookId: 10,
      fileIds: [21, 22],
      purpose: 'watch-download',
    }),
  };
  const auth = { validateUser: vi.fn().mockResolvedValue(user) };
  const book = {
    getFileInfo: vi.fn((fileId: number) =>
      Promise.resolve({
        path: `/books/${fileId}.m4b`,
        size: fileId * 1000,
        format: 'm4b',
        bookId: 10,
        originalFilename: `${fileId}.m4b`,
      }),
    ),
    getCoverPath: vi.fn().mockResolvedValue('/covers/10.jpg'),
  };
  const epub = {
    getMediaOverlayPlaylist: vi.fn().mockResolvedValue({
      bookId: 10,
      fileId: 31,
      durationSeconds: 90,
      items: [],
      sections: [],
      resources: [
        { href: 'OEBPS/audio/ch1.mp3', mediaType: 'audio/mpeg', size: 5_000 },
        { href: 'OEBPS/audio/ch2.mp3', mediaType: 'audio/mpeg', size: 6_000 },
      ],
    }),
  };
  const service = new WatchDownloadService(jwt as never, auth as never, book as never, new PermissionService(), epub as never);
  return { service, jwt, auth, book, epub, user };
}

function makeEpubService() {
  const made = makeService();
  made.book.getFileInfo.mockImplementation((fileId: number) =>
    Promise.resolve({ path: `/books/${fileId}.epub`, size: 400_000, format: 'epub', bookId: 10, originalFilename: `${fileId}.epub` }),
  );
  made.jwt.verifyAsync.mockResolvedValue({
    sub: '7',
    ver: 3,
    amr: 'password',
    bookId: 10,
    fileIds: [],
    purpose: 'watch-download',
    overlay: { fileId: 31, hrefs: ['OEBPS/audio/ch1.mp3', 'OEBPS/audio/ch2.mp3'] },
  });
  return made;
}

describe('WatchDownloadService', () => {
  it('issues a book-scoped ticket with Range download paths', async () => {
    const { service, jwt, user } = makeService();
    const response = await service.issue(10, [21, 22], user);

    expect(response).toMatchObject({
      token: 'watch-ticket',
      files: [
        { fileId: 21, format: 'm4b', sizeBytes: 21_000, downloadPath: '/api/v1/watch-downloads/files/21' },
        { fileId: 22, format: 'm4b', sizeBytes: 22_000, downloadPath: '/api/v1/watch-downloads/files/22' },
      ],
      coverPath: '/api/v1/watch-downloads/books/10/cover',
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({ ver: 3, amr: 'password', bookId: 10, fileIds: [21, 22], purpose: 'watch-download' }),
      expect.objectContaining({ subject: '7', audience: 'bookorbit-watch-download' }),
    );
  });

  it('rejects duplicate files and files from another book', async () => {
    const { service, book, user } = makeService();
    await expect(service.issue(10, [21, 21], user)).rejects.toBeInstanceOf(BadRequestException);
    book.getFileInfo.mockResolvedValueOnce({
      path: '/books/21.m4b',
      size: 100,
      format: 'm4b',
      bookId: 99,
      originalFilename: '21.m4b',
    });
    await expect(service.issue(10, [21], user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('authorizes only files included in a valid ticket', async () => {
    const { service, user } = makeService();
    await expect(service.authorize('Bearer ticket', undefined, 21)).resolves.toEqual(user);
    await expect(service.authorize('Bearer ticket', undefined, 99)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.authorize(undefined, undefined, 21)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('issues a media-overlay ticket addressing resources by ticket index', async () => {
    const { service, jwt, user } = makeEpubService();
    const response = await service.issueMediaOverlay(10, 31, ['OEBPS/audio/ch1.mp3', 'OEBPS/audio/ch2.mp3'], user);

    expect(response).toMatchObject({
      token: 'watch-ticket',
      files: [
        {
          href: 'OEBPS/audio/ch1.mp3',
          mediaType: 'audio/mpeg',
          sizeBytes: 5_000,
          downloadPath: '/api/v1/watch-downloads/media-overlay/files/0',
        },
        {
          href: 'OEBPS/audio/ch2.mp3',
          mediaType: 'audio/mpeg',
          sizeBytes: 6_000,
          downloadPath: '/api/v1/watch-downloads/media-overlay/files/1',
        },
      ],
      coverPath: '/api/v1/watch-downloads/books/10/cover',
    });
    expect(jwt.signAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        bookId: 10,
        amr: 'password',
        fileIds: [],
        purpose: 'watch-download',
        overlay: { fileId: 31, hrefs: ['OEBPS/audio/ch1.mp3', 'OEBPS/audio/ch2.mp3'] },
      }),
      expect.objectContaining({ subject: '7', audience: 'bookorbit-watch-download' }),
    );
  });

  it('rejects overlay hrefs that are not in the playlist, duplicates, and non-EPUB files', async () => {
    const { service, book, user } = makeEpubService();
    await expect(service.issueMediaOverlay(10, 31, ['OEBPS/audio/ghost.mp3'], user)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.issueMediaOverlay(10, 31, ['OEBPS/audio/ch1.mp3', 'OEBPS/audio/ch1.mp3'], user)).rejects.toBeInstanceOf(BadRequestException);
    book.getFileInfo.mockResolvedValueOnce({
      path: '/books/31.m4b',
      size: 100,
      format: 'm4b',
      bookId: 10,
      originalFilename: '31.m4b',
    });
    await expect(service.issueMediaOverlay(10, 31, ['OEBPS/audio/ch1.mp3'], user)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('resolves an overlay ticket index to its href and rejects out-of-range indices', async () => {
    const { service, user } = makeEpubService();
    await expect(service.authorizeMediaOverlay('Bearer ticket', 1)).resolves.toEqual({
      user,
      bookId: 10,
      fileId: 31,
      href: 'OEBPS/audio/ch2.mp3',
    });
    await expect(service.authorizeMediaOverlay('Bearer ticket', 2)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.authorizeMediaOverlay('Bearer ticket', -1)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('keeps the audiobook file route closed to media-overlay tickets', async () => {
    const { service } = makeEpubService();
    await expect(service.authorize('Bearer ticket', undefined, 31)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('refuses an audiobook ticket at the overlay route', async () => {
    const { service } = makeService();
    await expect(service.authorizeMediaOverlay('Bearer ticket', 0)).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
