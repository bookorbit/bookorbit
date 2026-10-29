import { BadRequestException, ConflictException } from '@nestjs/common';
import type { RegexMetadataReapplyJob } from '@bookorbit/types';

import { RegexMetadataReapplyService } from './regex-metadata-reapply.service';

const rules = { rules: [{ pattern: '^(?<series>[^/]+)/', flags: '' }] };
const owner = { id: 3, isSuperuser: false } as never;
const otherUser = { id: 4, isSuperuser: false } as never;

function makeRepo(books: { id: number; primaryFileId: number | null }[], regexMetadata: unknown = rules) {
  return {
    findLibrarySettings: vi.fn().mockResolvedValue({ regexMetadata, metadataPrecedence: ['embedded', 'regex'] }),
    getRuleReapplyBounds: vi.fn().mockResolvedValue({ total: books.length, maxId: Math.max(0, ...books.map(({ id }) => id)) }),
    findRuleReapplyBookBatch: vi
      .fn()
      .mockImplementation((_libraryId: number, afterId: number, maxId: number, limit: number) =>
        Promise.resolve(books.filter(({ id }) => id > afterId && id <= maxId).slice(0, limit)),
      ),
    findBookFilesByBookIds: vi.fn().mockImplementation((ids: number[]) => Promise.resolve(ids.map((id) => ({ id: id * 10, bookId: id })))),
  };
}

async function finished(service: RegexMetadataReapplyService, libraryId: number): Promise<RegexMetadataReapplyJob> {
  let job: RegexMetadataReapplyJob | null = null;
  await vi.waitFor(() => {
    job = service.get(libraryId, owner);
    expect(job?.status).not.toBe('running');
  });
  return job!;
}

describe('RegexMetadataReapplyService', () => {
  it('refuses a library without saved rules', async () => {
    const service = new RegexMetadataReapplyService(makeRepo([], null) as never, {} as never);
    await expect(service.start(1, owner)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('applies the rules to every present book and counts each outcome', async () => {
    const books = [1, 2, 3, 4].map((id) => ({ id, primaryFileId: id * 10 }));
    const repo = makeRepo(books);
    const outcomes = ['updated', 'unchanged', 'skipped', 'updated'];
    const scanner = { applyLibraryRulesToBook: vi.fn().mockImplementation((book: { id: number }) => Promise.resolve(outcomes[book.id - 1])) };
    const service = new RegexMetadataReapplyService(repo as never, scanner as never);

    await service.start(1, owner);
    const job = await finished(service, 1);

    expect(job).toMatchObject({ status: 'completed', total: 4, processed: 4, updated: 2, unchanged: 1, skipped: 1, failed: 0 });
    expect(scanner.applyLibraryRulesToBook).toHaveBeenCalledWith(books[0], [{ id: 10, bookId: 1 }], {
      config: rules,
      precedence: ['embedded', 'regex'],
    });
  });

  it('allows one run per library at a time', async () => {
    let release!: () => void;
    const gate = new Promise<string>((resolve) => (release = () => resolve('unchanged')));
    const scanner = { applyLibraryRulesToBook: vi.fn().mockReturnValue(gate) };
    const service = new RegexMetadataReapplyService(makeRepo([{ id: 1, primaryFileId: 10 }]) as never, scanner as never);

    await service.start(1, owner);
    await expect(service.start(1, owner)).rejects.toBeInstanceOf(ConflictException);
    release();
    await finished(service, 1);
  });

  it('stops when the rules themselves cannot run', async () => {
    const books = [1, 2, 3].map((id) => ({ id, primaryFileId: id * 10 }));
    const scanner = { applyLibraryRulesToBook: vi.fn().mockResolvedValue('rules_invalid') };
    const service = new RegexMetadataReapplyService(makeRepo(books) as never, scanner as never);

    await service.start(1, owner);

    expect(await finished(service, 1)).toMatchObject({
      status: 'failed',
      processed: 1,
      failed: 1,
      failureSamples: [{ bookId: 1, code: 'rules_invalid' }],
    });
  });

  it('reports a book whose files could not be read as failed', async () => {
    const books = [1, 2].map((id) => ({ id, primaryFileId: id * 10 }));
    const scanner = { applyLibraryRulesToBook: vi.fn().mockResolvedValueOnce('file_unavailable').mockResolvedValueOnce('updated') };
    const service = new RegexMetadataReapplyService(makeRepo(books) as never, scanner as never);

    await service.start(1, owner);

    expect(await finished(service, 1)).toMatchObject({
      status: 'completed',
      processed: 2,
      updated: 1,
      failed: 1,
      failureSamples: [{ bookId: 1, code: 'file_unavailable' }],
    });
  });

  it('keeps the counts adding up when books disappear or come back during a run', async () => {
    const scanner = { applyLibraryRulesToBook: vi.fn().mockResolvedValue('updated') };
    const gone = makeRepo([{ id: 1, primaryFileId: 10 }]);
    gone.getRuleReapplyBounds.mockResolvedValue({ total: 3, maxId: 3 });
    const back = makeRepo([1, 2, 3].map((id) => ({ id, primaryFileId: id * 10 })));
    back.getRuleReapplyBounds.mockResolvedValue({ total: 2, maxId: 3 });
    const goneService = new RegexMetadataReapplyService(gone as never, scanner as never);
    const backService = new RegexMetadataReapplyService(back as never, scanner as never);

    await goneService.start(1, owner);
    await backService.start(1, owner);

    expect(await finished(goneService, 1)).toMatchObject({ total: 3, processed: 3, updated: 1, skipped: 2 });
    expect(await finished(backService, 1)).toMatchObject({ total: 3, processed: 3, updated: 3, skipped: 0 });
  });

  it('records a failing book and carries on', async () => {
    const books = [1, 2, 3].map((id) => ({ id, primaryFileId: id * 10 }));
    const scanner = {
      applyLibraryRulesToBook: vi
        .fn()
        .mockRejectedValueOnce(new Error('archive unreadable'))
        .mockResolvedValueOnce('rules_unavailable')
        .mockResolvedValueOnce('updated')
        .mockResolvedValueOnce('rules_unavailable'),
    };
    const service = new RegexMetadataReapplyService(makeRepo(books) as never, scanner as never);

    await service.start(1, owner);
    const job = await finished(service, 1);

    expect(job).toMatchObject({ status: 'completed', updated: 1, failed: 2 });
    expect(job.failureSamples).toEqual([
      { bookId: 1, code: 'metadata_failed' },
      { bookId: 2, code: 'rules_unavailable' },
    ]);
  });

  it('retries a book the rule worker could not evaluate once the rest of its batch is done', async () => {
    const books = [1, 2].map((id) => ({ id, primaryFileId: id * 10 }));
    const scanner = {
      applyLibraryRulesToBook: vi.fn().mockResolvedValueOnce('rules_unavailable').mockResolvedValueOnce('updated').mockResolvedValueOnce('updated'),
    };
    const service = new RegexMetadataReapplyService(makeRepo(books) as never, scanner as never);

    await service.start(1, owner);
    const job = await finished(service, 1);

    expect(job).toMatchObject({ status: 'completed', updated: 2, failed: 0 });
    expect(scanner.applyLibraryRulesToBook).toHaveBeenCalledTimes(3);
    expect(scanner.applyLibraryRulesToBook.mock.calls[2][0]).toEqual(books[0]);
  });

  it('shows a run only to the person who started it or a superuser', async () => {
    const scanner = { applyLibraryRulesToBook: vi.fn().mockResolvedValue('unchanged') };
    const service = new RegexMetadataReapplyService(makeRepo([{ id: 1, primaryFileId: 10 }]) as never, scanner as never);

    await service.start(1, owner);
    await finished(service, 1);

    expect(service.get(1, otherUser)).toBeNull();
    expect(service.get(1, { id: 9, isSuperuser: true } as never)).not.toBeNull();
  });
});
