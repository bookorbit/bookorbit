import { Permission } from '@bookorbit/types';

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
    };
    return { controller: new BookDuplicatesController(service as never), service };
  }

  it('requires the book deletion permission for the controller', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, BookDuplicatesController)).toBe(Permission.LibraryDeleteBooks);
  });

  it('delegates scan creation, status, and group listing with the current user', async () => {
    const { controller, service } = setup();
    const createDto = { libraryId: 3, similarityPercent: 85 };
    const listDto = { page: 2, pageSize: 10, reason: 'isbn' as const };

    await controller.createScan(createDto, user);
    await controller.getActiveScan(user);
    await controller.getScan(9, user);
    await controller.getGroups(9, listDto, user);

    expect(service.createScan).toHaveBeenCalledWith(createDto, user);
    expect(service.getActiveScan).toHaveBeenCalledWith(user);
    expect(service.getScan).toHaveBeenCalledWith(9, user);
    expect(service.getGroups).toHaveBeenCalledWith(9, listDto, user);
  });
});
