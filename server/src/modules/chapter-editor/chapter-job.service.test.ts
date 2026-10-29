import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { Permission, BOOK_CHAPTERS_ERROR_CODES } from '@bookorbit/types';
import { appConfig } from '../../config/config';
import type { RequestUser } from '../../common/types/request-user';
import { BookService } from '../book/book.service';
import { UserService } from '../user/user.service';
import { ChapterEditorService } from './chapter-editor.service';
import { ChapterJobRepository } from './chapter-job.repository';
import { ChapterJobService } from './chapter-job.service';

const user = { id: 7, active: true, isSuperuser: false, permissions: [Permission.LibraryEditMetadata] } as RequestUser;
const queued = { id: 'job', userId: 7, bookId: 9, baseRevision: 'a'.repeat(64), kind: 'read' };
async function setup() {
  const repo = {
    enqueue: vi.fn(),
    find: vi.fn(),
    latest: vi.fn(),
    claim: vi.fn().mockResolvedValue(queued),
    recover: vi.fn().mockResolvedValue(undefined),
    progress: vi.fn().mockResolvedValue(undefined),
    finish: vi.fn().mockResolvedValue(undefined),
  };
  const editor = { readEmbedded: vi.fn().mockResolvedValue({ chapters: [] }), revert: vi.fn(), writeToFiles: vi.fn() };
  const books = { verifyBookAccess: vi.fn().mockResolvedValue(undefined) };
  const users = { findByIdWithPermissions: vi.fn().mockResolvedValue(user) };
  const module = await Test.createTestingModule({
    providers: [
      ChapterJobService,
      { provide: ChapterJobRepository, useValue: repo },
      { provide: ChapterEditorService, useValue: editor },
      { provide: BookService, useValue: books },
      { provide: UserService, useValue: users },
      { provide: appConfig.KEY, useValue: { nodeEnv: 'test' } },
    ],
  }).compile();
  return { service: module.get(ChapterJobService), repo, editor, books, users };
}

describe('ChapterJobService', () => {
  it('requires book access before enqueueing and scopes status to the initiating user', async () => {
    const { service, repo, books } = await setup();
    books.verifyBookAccess.mockRejectedValueOnce(new NotFoundException());
    await expect(service.start(9, 'read', queued.baseRevision, user)).rejects.toBeInstanceOf(NotFoundException);
    expect(books.verifyBookAccess).toHaveBeenCalledWith(9, user, 'editor');
    expect(repo.enqueue).not.toHaveBeenCalled();
    repo.find.mockResolvedValue(null);
    await expect(service.status(9, 'job', user)).rejects.toBeInstanceOf(NotFoundException);
    expect(repo.find).toHaveBeenCalledWith(9, user.id, 'job');
  });

  it.each([null, { ...user, active: false }, { ...user, permissions: [] }])(
    'rejects an execution when the initiating user no longer has permission: %s',
    async (current) => {
      const { service, repo, editor, users } = await setup();
      users.findByIdWithPermissions.mockResolvedValue(current);
      await service.tick();
      expect(editor.readEmbedded).not.toHaveBeenCalled();
      expect(repo.finish).toHaveBeenCalledWith('job', undefined, 'book_chapters_operation_failed');
    },
  );

  it('persists read progress and the completed result', async () => {
    const { service, repo, editor } = await setup();
    editor.readEmbedded.mockImplementationOnce(async (_book, _user, progress) => {
      await progress(1, 2);
      return { chapters: [] };
    });
    await service.tick();
    expect(repo.progress).toHaveBeenCalledWith('job', 1, 2);
    expect(repo.finish).toHaveBeenCalledWith('job', { chapters: [] });
  });

  it('retains the stable error code when a queued revision is stale', async () => {
    const { service, repo, editor } = await setup();
    editor.readEmbedded.mockRejectedValueOnce(new ConflictException({ errorCode: BOOK_CHAPTERS_ERROR_CODES.stale }));
    await service.tick();
    expect(repo.finish).toHaveBeenCalledWith('job', undefined, BOOK_CHAPTERS_ERROR_CODES.stale);
  });

  it('recovers a stranded processing row when persisting a terminal state fails', async () => {
    const { service, repo } = await setup();
    repo.finish.mockRejectedValue(new Error('connection terminated'));
    repo.recover.mockRejectedValueOnce(new Error('connection terminated'));
    await service.tick();
    expect(repo.recover).toHaveBeenCalledOnce();
    repo.finish.mockResolvedValue(undefined);
    await service.tick();
    expect(repo.claim).toHaveBeenCalledTimes(2);
    expect(repo.recover).toHaveBeenCalledTimes(2);
  });
});
