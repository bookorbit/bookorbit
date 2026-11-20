import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { AuditAction, AuditResource, Permission } from '@bookorbit/types';

import { AUDITABLE_KEY } from '../../common/decorators/auditable.decorator';
import { FORBIDDEN_PERMISSION_KEY } from '../../common/decorators/forbid-permission.decorator';
import { PERMISSION_KEY } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import type { BulkRunsService, StartBulkRun } from '../bulk-runs/bulk-runs.service';
import { BookMoveController } from './book-move.controller';
import type { BookMoveService } from './book-move.service';
import type { MoveBooksDto } from './dto/move-books.dto';

const USER = { id: 7, username: 'mover', isSuperuser: false, permissions: [Permission.LibraryEditMetadata] } as unknown as RequestUser;
const DTO = { selection: { bookIds: [1, 2] }, targetLibraryId: 2, targetFolderId: 22, collisionPolicy: 'suggested' } as MoveBooksDto;
const PLAN = {
  subjectIds: [1, 2],
  options: { targetLibraryId: 2, targetFolderId: 22, collisionPolicy: 'suggested' as const, overrides: [], sourceLibraryIds: [1] },
};

function setup() {
  const moves = { planRun: vi.fn().mockResolvedValue(PLAN), preview: vi.fn() };
  const bulkRuns = { startAndStream: vi.fn().mockResolvedValue(undefined) };
  const controller = new BookMoveController(moves as unknown as BookMoveService, bulkRuns as unknown as BulkRunsService);
  const reply = { raw: { writeHead: vi.fn() } } as unknown as FastifyReply;
  return { controller, moves, bulkRuns, reply };
}

describe('BookMoveController.move', () => {
  it('queues the planned books as a book-move run and streams it', async () => {
    const { controller, moves, bulkRuns, reply } = setup();

    await controller.move(DTO, USER, reply);

    expect(moves.planRun).toHaveBeenCalledWith(DTO, USER);
    const input = bulkRuns.startAndStream.mock.calls[0]![1] as StartBulkRun;
    expect(bulkRuns.startAndStream.mock.calls[0]![0]).toBe(reply);
    expect(input).toMatchObject({ kind: 'book-move', subjectIds: [1, 2], options: PLAN.options, actor: USER });
    expect(input.audit).toMatchObject({
      action: AuditAction.BookBulkMoveLibrary,
      resource: AuditResource.Book,
      meta: { targetLibraryId: 2, targetFolderId: 22 },
    });
    expect(input.audit.description(2)).toBe('Moved 2 books to library #2');
    expect(input.audit.description(1)).toBe('Moved 1 book to library #2');
  });

  it.each([
    ['a missing target', new NotFoundException('Target library folder not found')],
    ['an empty selection', new BadRequestException('No books matched the selection')],
    ['no editor access', new ForbiddenException('Editor access is required')],
    ['a scan holding a library', new ConflictException('A scan is running for library 1.')],
  ])('answers %s before any stream starts', async (_case, error) => {
    const { controller, moves, bulkRuns, reply } = setup();
    moves.planRun.mockRejectedValue(error);

    await expect(controller.move(DTO, USER, reply)).rejects.toBe(error);

    expect(bulkRuns.startAndStream).not.toHaveBeenCalled();
    expect(reply.raw.writeHead).not.toHaveBeenCalled();
  });

  it('keeps the edit permission, refuses demo accounts and audits at creation instead of per request', () => {
    const handler = BookMoveController.prototype.move;

    expect(Reflect.getMetadata(PERMISSION_KEY, handler)).toBe(Permission.LibraryEditMetadata);
    expect(Reflect.getMetadata(FORBIDDEN_PERMISSION_KEY, handler)).toEqual({
      permission: Permission.DemoRestricted,
      message: 'Demo-restricted account cannot move books',
    });
    expect(Reflect.getMetadata(AUDITABLE_KEY, handler)).toBeUndefined();
  });
});
