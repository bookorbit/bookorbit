import { Permission } from '@bookorbit/types';

import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import { ChapterHealthController } from './chapter-health.controller';

describe('ChapterHealthController', () => {
  const user = { id: 7 } as never;

  function setup() {
    const service = {
      summary: vi.fn().mockResolvedValue({ counts: {}, withAsin: {} }),
      list: vi.fn().mockResolvedValue({ items: [], total: 0 }),
      enqueue: vi.fn().mockResolvedValue({ queued: 1, skipped: 0 }),
      state: vi.fn().mockResolvedValue({ queued: 0, processing: null, finished: {} }),
      cancel: vi.fn().mockResolvedValue({ removed: 0 }),
      clearFinished: vi.fn().mockResolvedValue({ removed: 0 }),
      dismissReview: vi.fn().mockResolvedValue(undefined),
    };
    return { controller: new ChapterHealthController(service as never), service };
  }

  it('requires the metadata editing permission for the controller', () => {
    expect(Reflect.getMetadata(PERMISSION_KEY, ChapterHealthController)).toBe(Permission.LibraryEditMetadata);
  });

  it('answers 200 to a queue request and 204 to a dismissal', () => {
    expect(Reflect.getMetadata('__httpCode__', ChapterHealthController.prototype.enqueue)).toBe(200);
    expect(Reflect.getMetadata('__httpCode__', ChapterHealthController.prototype.dismissReview)).toBe(204);
  });

  it('delegates every route to the service with the current user', async () => {
    const { controller, service } = setup();
    const listDto = { category: 'needs_review' as const, page: 2, pageSize: 10, libraryId: 3 };
    const enqueueDto = { category: 'no_chapters' as const };

    await controller.summary({ libraryId: 3 }, user);
    await controller.list(listDto, user);
    await controller.enqueue(enqueueDto, user);
    await controller.state(user);
    await controller.cancel(user);
    await controller.clearFinished(user);
    await controller.dismissReview(41, user);

    expect(service.summary).toHaveBeenCalledWith(user, 3);
    expect(service.list).toHaveBeenCalledWith(user, listDto);
    expect(service.enqueue).toHaveBeenCalledWith(user, enqueueDto);
    expect(service.state).toHaveBeenCalledWith(user);
    expect(service.cancel).toHaveBeenCalledWith(user);
    expect(service.clearFinished).toHaveBeenCalledWith(user);
    expect(service.dismissReview).toHaveBeenCalledWith(user, 41);
  });
});
