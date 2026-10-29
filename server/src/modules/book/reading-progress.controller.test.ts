import { BadRequestException } from '@nestjs/common';
import { describe, expect, it, vi } from 'vitest';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ReadingProgressController } from './reading-progress.controller';

const user = { id: 7 } as RequestUser;

function makeController() {
  const progress = {
    forFile: vi.fn().mockResolvedValue({ items: [] }),
    forBook: vi.fn().mockResolvedValue({ items: [] }),
    save: vi.fn().mockResolvedValue({ results: [] }),
    clear: vi.fn().mockResolvedValue(undefined),
  };
  return { controller: new ReadingProgressController(progress as never), progress };
}

describe('ReadingProgressController', () => {
  it('reads one file or one book', async () => {
    const { controller, progress } = makeController();
    await controller.list({ fileId: 64 }, user);
    await controller.list({ bookId: 60 }, user);
    expect(progress.forFile).toHaveBeenCalledWith(64, user);
    expect(progress.forBook).toHaveBeenCalledWith(60, user);
  });

  it('rejects a read that names both a file and a book, or neither', () => {
    const { controller } = makeController();
    expect(() => controller.list({ fileId: 64, bookId: 60 }, user)).toThrow(BadRequestException);
    expect(() => controller.list({}, user)).toThrow(BadRequestException);
  });

  it('passes the writes and the caller through', async () => {
    const { controller, progress } = makeController();
    const writes = [{ fileId: 64, percentage: 8 }];
    await controller.save({ writes }, user);
    expect(progress.save).toHaveBeenCalledWith(writes, user);
  });

  it('clears one file for the caller', async () => {
    const { controller, progress } = makeController();
    await controller.clear(64, user);
    expect(progress.clear).toHaveBeenCalledWith(64, user);
  });

  it('requires no permission, since every route touches only the caller position', () => {
    for (const route of [
      ReadingProgressController.prototype.list,
      ReadingProgressController.prototype.save,
      ReadingProgressController.prototype.clear,
    ]) {
      expect(Reflect.getMetadata(PERMISSION_KEY, route)).toBeUndefined();
    }
  });
});
