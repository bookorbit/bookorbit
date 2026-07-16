import { describe, expect, it, vi } from 'vitest';
import type { RequestUser } from '../../common/types/request-user';
import { ReadingAttemptController } from './reading-attempt.controller';

const user = { id: 7 } as RequestUser;

function makeController() {
  const attempts = {
    list: vi.fn().mockResolvedValue({ items: [], page: 1, pageSize: 20, total: 0 }),
    createHistorical: vi.fn().mockResolvedValue({ id: 1 }),
    update: vi.fn().mockResolvedValue({ id: 1 }),
    delete: vi.fn().mockResolvedValue(undefined),
  };
  const books = {
    verifyBookAccess: vi.fn().mockResolvedValue(undefined),
    clearBookProgressForReread: vi.fn().mockResolvedValue(undefined),
    setReadStatus: vi.fn().mockResolvedValue({ status: 'rereading' }),
  };
  return { controller: new ReadingAttemptController(attempts as never, books as never), attempts, books };
}

describe('ReadingAttemptController', () => {
  it('verifies access before listing user-scoped attempts', async () => {
    const { controller, attempts, books } = makeController();
    await controller.list(10, { page: 2, pageSize: 25 }, user);
    expect(books.verifyBookAccess).toHaveBeenCalledWith(10, user);
    expect(attempts.list).toHaveBeenCalledWith(7, 10, 2, 25);
  });

  it('resets progress before starting a reread by default', async () => {
    const { controller, books } = makeController();
    await controller.startReread(10, {}, user);
    expect(books.clearBookProgressForReread).toHaveBeenCalledWith(7, 10, user);
    expect(books.setReadStatus).toHaveBeenCalledWith(10, { status: 'rereading' }, user);
    expect(books.clearBookProgressForReread.mock.invocationCallOrder[0]).toBeLessThan(books.setReadStatus.mock.invocationCallOrder[0]!);
  });

  it('does not reset progress when explicitly disabled', async () => {
    const { controller, books } = makeController();
    await controller.startReread(10, { resetProgress: false }, user);
    expect(books.clearBookProgressForReread).not.toHaveBeenCalled();
  });

  it('passes user and book ownership to deletion', async () => {
    const { controller, attempts } = makeController();
    await controller.delete(10, 4, user);
    expect(attempts.delete).toHaveBeenCalledWith(7, 10, 4);
  });
});
