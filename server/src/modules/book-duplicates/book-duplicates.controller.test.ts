import { Permission } from '@bookorbit/types';

import { ANY_PERMISSION_KEY } from '../../common/decorators/require-any-permission.decorator';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { BookDuplicatesController } from './book-duplicates.controller';

describe('BookDuplicatesController', () => {
  const user = { id: 7 } as never;

  function setup() {
    const service = {
      createScan: vi.fn().mockResolvedValue({ id: 1 }),
      getActiveScan: vi.fn().mockResolvedValue({ id: 1 }),
      getScan: vi.fn().mockResolvedValue({ id: 1 }),
      getGroups: vi.fn().mockResolvedValue({ groups: [], total: 0, page: 1, pageSize: 20 }),
      restoreDismissal: vi.fn().mockResolvedValue(undefined),
    };
    const resolutions = {
      start: vi.fn().mockResolvedValue({ jobId: 3, total: 1 }),
      getJob: vi.fn().mockResolvedValue({ id: 3 }),
    };
    return { controller: new BookDuplicatesController(service as never, resolutions as never), service, resolutions };
  }

  it('keeps the book deletion permission as the controller default', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, BookDuplicatesController)).toBe(Permission.LibraryDeleteBooks);
  });

  it.each([
    'createScan',
    'getActiveScan',
    'getScan',
    'getGroups',
    'listDismissals',
    'dismissGroup',
    'restoreDismissal',
    'startResolution',
    'getResolution',
  ] as const)('opens %s to a user who may delete or merge books (H11)', (method) => {
    expect(Reflect.getMetadata(ANY_PERMISSION_KEY, BookDuplicatesController.prototype[method])).toEqual([
      Permission.LibraryDeleteBooks,
      Permission.LibraryMergeBooks,
    ]);
  });

  it('delegates scan creation, status, and group listing with the current user', async () => {
    const { controller, service } = setup();
    const createDto = { libraryId: 3, similarityPercent: 85 };
    const listDto = {
      page: 2,
      pageSize: 10,
      reason: 'isbn' as const,
      sortBy: 'reclaimable' as const,
      order: 'desc' as const,
      kind: 'duplicate' as const,
    };

    await controller.createScan(createDto, user);
    await controller.getActiveScan(user);
    await controller.getScan(9, user);
    await controller.getGroups(9, listDto, user);

    expect(service.createScan).toHaveBeenCalledWith(createDto, user);
    expect(service.getActiveScan).toHaveBeenCalledWith(user);
    expect(service.getScan).toHaveBeenCalledWith(9, user);
    expect(service.getGroups).toHaveBeenCalledWith(9, listDto, user);
  });

  it('restores a dismissal of the requested kind', async () => {
    const { controller, service } = setup();

    await controller.restoreDismissal(4, 9, { kind: 'other_format' }, user);

    expect(service.restoreDismissal).toHaveBeenCalledWith(4, 9, user, 'other_format');
  });

  it('starts and reads resolutions for the current user', async () => {
    const { controller, resolutions } = setup();
    const dto = { scanId: 2, groups: [{ groupId: 5, keeperId: 8, action: 'merge' as const }] };

    await expect(controller.startResolution(dto, user)).resolves.toEqual({ jobId: 3, total: 1 });
    await controller.getResolution(3, user);

    expect(resolutions.start).toHaveBeenCalledWith(dto, user);
    expect(resolutions.getJob).toHaveBeenCalledWith(3, user);
  });
});
