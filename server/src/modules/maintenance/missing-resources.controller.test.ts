import { Permission } from '@bookorbit/types';
import { describe, expect, it, vi } from 'vitest';

import { FORBIDDEN_PERMISSION_KEY } from '../../common/decorators/forbid-permission.decorator';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { MissingResourcesController } from './missing-resources.controller';

describe('MissingResourcesController', () => {
  const user = { id: 7 } as never;

  function setup() {
    const service = {
      getSummary: vi.fn().mockResolvedValue({ missingBooks: 0, sweep: null }),
      getSweep: vi.fn().mockReturnValue(null),
      startSweep: vi.fn().mockResolvedValue({ status: 'running' }),
      listMissingBooks: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
      listBrokenCovers: vi.fn().mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 50 }),
      listOrphanedCoverDirs: vi.fn().mockReturnValue({ items: [], total: 0, page: 1, pageSize: 50 }),
      cleanMissingBooks: vi.fn().mockResolvedValue({ category: 'missing_books', requested: 1, cleaned: 1, skipped: 0, remaining: 0 }),
      cleanBrokenCovers: vi.fn().mockResolvedValue({ category: 'broken_covers', requested: 1, cleaned: 1, skipped: 0, remaining: 0 }),
      cleanOrphanedCoverDirs: vi.fn().mockResolvedValue({ category: 'orphaned_cover_dirs', requested: 1, cleaned: 1, skipped: 0, remaining: 0 }),
    };
    return { controller: new MissingResourcesController(service as never), service };
  }

  it('requires the book deletion permission to reach the tool at all', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, MissingResourcesController)).toBe(Permission.LibraryDeleteBooks);
  });

  it('requires metadata editing on top of deletion to clear cover references', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, MissingResourcesController.prototype.cleanBrokenCovers)).toEqual([
      Permission.LibraryDeleteBooks,
      Permission.LibraryEditMetadata,
    ]);
  });

  it('requires library management to remove cover folders from disk', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, MissingResourcesController.prototype.cleanOrphanedCoverDirs)).toEqual([
      Permission.LibraryDeleteBooks,
      Permission.ManageLibraries,
    ]);
  });

  it.each([['cleanMissingBooks'], ['cleanBrokenCovers'], ['cleanOrphanedCoverDirs']] as const)('blocks demo accounts from %s', (method) => {
    expect(Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, MissingResourcesController.prototype[method])).toMatchObject({
      permission: Permission.DemoRestricted,
    });
  });

  it('delegates reads to the service with the current user', async () => {
    const { controller, service } = setup();
    const listDto = { page: 2, pageSize: 25 };

    await controller.getSummary(user);
    controller.getSweep(user);
    await controller.startSweep(user);
    await controller.listMissingBooks(listDto, user);
    await controller.listBrokenCovers(listDto, user);
    controller.listOrphanedCoverDirs(listDto, user);

    expect(service.getSummary).toHaveBeenCalledWith(user);
    expect(service.getSweep).toHaveBeenCalledWith(user);
    expect(service.startSweep).toHaveBeenCalledWith(user);
    expect(service.listMissingBooks).toHaveBeenCalledWith(user, 2, 25);
    expect(service.listBrokenCovers).toHaveBeenCalledWith(user, 2, 25);
    expect(service.listOrphanedCoverDirs).toHaveBeenCalledWith(user, 2, 25);
  });

  it('delegates each cleanup to its own service method', async () => {
    const { controller, service } = setup();
    const dto = { bookIds: [1, 2] };

    await controller.cleanMissingBooks(dto, user);
    await controller.cleanBrokenCovers(dto, user);
    await controller.cleanOrphanedCoverDirs(dto, user);

    expect(service.cleanMissingBooks).toHaveBeenCalledWith(user, dto);
    expect(service.cleanBrokenCovers).toHaveBeenCalledWith(user, dto);
    expect(service.cleanOrphanedCoverDirs).toHaveBeenCalledWith(user, dto);
  });
});
