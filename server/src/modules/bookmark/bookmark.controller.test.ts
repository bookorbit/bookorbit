import type { RequestUser } from '../../common/types/request-user';
import { BookmarkController } from './bookmark.controller';
import type { CreateBookmarkDto } from './dto/create-bookmark.dto';

describe('BookmarkController', () => {
  const user: RequestUser = {
    id: 8,
    username: 'bookmark-user',
    name: 'Bookmark User',
    email: null,
    active: true,
    isDefaultPassword: false,
    tokenVersion: 1,
    settings: {},
    avatarUrl: null,
    provisioningMethod: 'local',
    isSuperuser: false,
    permissions: [],
  };

  const service = {
    getBookmarks: vi.fn(),
    createBookmark: vi.fn(),
    deleteBookmark: vi.fn(),
  };

  const controller = new BookmarkController(service as never);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('delegates getBookmarks with book id and current user', async () => {
    service.getBookmarks.mockResolvedValue([]);

    await controller.getBookmarks(5, user);

    expect(service.getBookmarks).toHaveBeenCalledWith(5, user);
  });

  it('delegates createBookmark with payload and user', async () => {
    const dto: CreateBookmarkDto = { cfi: 'epubcfi(/6/2)', title: 'Chapter 1' };
    service.createBookmark.mockResolvedValue({ id: 1 });

    await controller.createBookmark(5, dto, user);

    expect(service.createBookmark).toHaveBeenCalledWith(5, user, dto);
  });

  it('delegates deleteBookmark with book, bookmark, and user', async () => {
    service.deleteBookmark.mockResolvedValue(undefined);

    await controller.deleteBookmark(5, 15, user);

    expect(service.deleteBookmark).toHaveBeenCalledWith(5, 15, user);
  });
});
