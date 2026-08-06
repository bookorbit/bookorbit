import type { Mock } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';
import { FileLockService } from '../file-write/file-lock.service';
import { BookMoveExecutorService } from './book-move-executor.service';
import type { BookMovePlan } from './book-move-planner.service';
import type { BookMoveRepository } from './book-move.repository';
import type { MoveTargetLibrary } from './book-move.repository';
import { pathExists } from './book-move.utils';

let workDir: string;
let sourceRoot: string;
let targetRoot: string;
let executor: BookMoveExecutorService;
let registry: SelfWriteRegistry;
type ApplyMoveResult = { moved: boolean; mergedBookId: number | null };
let applyBookMove: Mock<(input: unknown) => Promise<ApplyMoveResult>>;

function makeTarget(): MoveTargetLibrary {
  return {
    libraryId: 2,
    libraryName: 'Manga',
    organizationMode: 'book_per_folder',
    fileNamingPattern: null,
    allowedFormats: [],
    folderId: 22,
    folderPath: targetRoot,
    watch: false,
  };
}

function makePlan(overrides: Partial<BookMovePlan> = {}): BookMovePlan {
  const bookFolder = join(sourceRoot, 'Frank Herbert', 'Dune');
  return {
    bookId: 1,
    title: 'Dune',
    sourceLibraryId: 1,
    sourceLibraryFolderPath: sourceRoot,
    sourceFolderPath: bookFolder,
    sourceHasOwnFolder: true,
    currentPath: join(bookFolder, 'Dune.epub'),
    targetPath: join(targetRoot, 'Dune', 'Dune.epub'),
    targetFolderPathKey: join(targetRoot, 'Dune'),
    files: [
      {
        fileId: 10,
        from: join(bookFolder, 'Dune.epub'),
        to: join(targetRoot, 'Dune', 'Dune.epub'),
        role: 'content',
        format: 'epub',
        fileHash: null,
      },
    ],
    layoutChange: null,
    primaryFormat: 'epub',
    ...overrides,
  };
}

beforeEach(async () => {
  workDir = await mkdtemp(join(tmpdir(), 'bookorbit-move-exec-'));
  sourceRoot = join(workDir, 'libA');
  targetRoot = join(workDir, 'libB');
  await mkdir(join(sourceRoot, 'Frank Herbert', 'Dune'), { recursive: true });
  await mkdir(targetRoot, { recursive: true });

  registry = new SelfWriteRegistry();
  applyBookMove = vi.fn<(input: unknown) => Promise<ApplyMoveResult>>().mockResolvedValue({ moved: true, mergedBookId: null });
  const repo = { applyBookMove } as unknown as BookMoveRepository;
  executor = new BookMoveExecutorService(repo, new FileLockService(), registry);
});

afterEach(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe('successful move', () => {
  it('moves files and records post-move stats in a single transaction', async () => {
    const plan = makePlan();
    await writeFile(plan.files[0].from, 'dune contents');

    const result = await executor.execute({ plan, target: makeTarget() });

    expect(result).toMatchObject({ status: 'success', crossDevice: false });
    expect(await readFile(plan.files[0].to, 'utf8')).toBe('dune contents');
    expect(await pathExists(plan.files[0].from)).toBe(false);

    expect(applyBookMove).toHaveBeenCalledTimes(1);
    const [call] = applyBookMove.mock.calls[0];
    expect(call).toMatchObject({
      bookId: 1,
      targetLibraryId: 2,
      targetFolderId: 22,
      targetFolderPathKey: join(targetRoot, 'Dune'),
      mergeDuplicateBookId: null,
    });
    expect(call.fileUpdates).toHaveLength(1);
    expect(call.fileUpdates[0]).toMatchObject({
      fileId: 10,
      absolutePath: join(targetRoot, 'Dune', 'Dune.epub'),
      relPath: join('Dune', 'Dune.epub'),
      sizeBytes: 'dune contents'.length,
    });
    // Stats must come from the destination so the watcher's identity check passes.
    expect(typeof call.fileUpdates[0].ino).toBe('bigint');
    expect(call.fileUpdates[0].mtime).toBeInstanceOf(Date);
  });

  it('writes the database only after every file has landed', async () => {
    const plan = makePlan();
    await writeFile(plan.files[0].from, 'x');
    let fileExistedAtDbWrite = false;
    applyBookMove.mockImplementation(async () => {
      fileExistedAtDbWrite = await pathExists(plan.files[0].to);
      return { moved: true, mergedBookId: null };
    });

    await executor.execute({ plan, target: makeTarget() });

    expect(fileExistedAtDbWrite).toBe(true);
  });

  it('removes the emptied source folder and its parent', async () => {
    const plan = makePlan();
    await writeFile(plan.files[0].from, 'x');

    await executor.execute({ plan, target: makeTarget() });

    expect(await pathExists(plan.sourceFolderPath)).toBe(false);
    expect(await pathExists(join(sourceRoot, 'Frank Herbert'))).toBe(false);
    expect(await pathExists(sourceRoot)).toBe(true);
  });

  it('moves every file of a multi-file book', async () => {
    const bookFolder = join(sourceRoot, 'Frank Herbert', 'Dune');
    const plan = makePlan({
      files: [
        {
          fileId: 10,
          from: join(bookFolder, 'Dune.epub'),
          to: join(targetRoot, 'Dune', 'Dune.epub'),
          role: 'content',
          format: 'epub',
          fileHash: null,
        },
        { fileId: 11, from: join(bookFolder, 'cover.jpg'), to: join(targetRoot, 'Dune', 'cover.jpg'), role: 'cover', format: 'jpg', fileHash: null },
      ],
    });
    await writeFile(plan.files[0].from, 'book');
    await writeFile(plan.files[1].from, 'cover');

    const result = await executor.execute({ plan, target: makeTarget() });

    expect(result.status).toBe('success');
    expect(await readFile(plan.files[1].to, 'utf8')).toBe('cover');
    expect(applyBookMove.mock.calls[0][0].fileUpdates).toHaveLength(2);
  });

  it('reports a merge when the transaction replaced a duplicate', async () => {
    const plan = makePlan();
    await writeFile(plan.files[0].from, 'x');
    applyBookMove.mockResolvedValue({ moved: true, mergedBookId: 55 });

    const result = await executor.execute({ plan, target: makeTarget(), mergeDuplicateBookId: 55 });

    expect(result).toMatchObject({ status: 'merged', mergedBookId: 55 });
    expect(applyBookMove.mock.calls[0][0].mergeDuplicateBookId).toBe(55);
  });
});

describe('pre-flight checks', () => {
  it('skips when a source file vanished before the move', async () => {
    const plan = makePlan();

    const result = await executor.execute({ plan, target: makeTarget() });

    expect(result).toMatchObject({ status: 'skipped' });
    expect(applyBookMove).not.toHaveBeenCalled();
  });

  it('skips rather than overwriting an occupied destination', async () => {
    const plan = makePlan();
    await writeFile(plan.files[0].from, 'source');
    await mkdir(join(targetRoot, 'Dune'), { recursive: true });
    await writeFile(plan.files[0].to, 'existing');

    const result = await executor.execute({ plan, target: makeTarget() });

    expect(result).toMatchObject({ status: 'skipped' });
    expect(await readFile(plan.files[0].to, 'utf8')).toBe('existing');
    expect(await readFile(plan.files[0].from, 'utf8')).toBe('source');
    expect(applyBookMove).not.toHaveBeenCalled();
  });
});

describe('rollback', () => {
  it('restores already-moved files when a later file fails', async () => {
    const bookFolder = join(sourceRoot, 'Frank Herbert', 'Dune');
    const plan = makePlan({
      files: [
        {
          fileId: 10,
          from: join(bookFolder, 'Dune.epub'),
          to: join(targetRoot, 'Dune', 'Dune.epub'),
          role: 'content',
          format: 'epub',
          fileHash: null,
        },
        // The second file does not exist, so the book is skipped after the first moved.
        {
          fileId: 11,
          from: join(bookFolder, 'missing.jpg'),
          to: join(targetRoot, 'Dune', 'missing.jpg'),
          role: 'cover',
          format: 'jpg',
          fileHash: null,
        },
      ],
    });
    await writeFile(plan.files[0].from, 'book');

    const result = await executor.execute({ plan, target: makeTarget() });

    expect(result.status).toBe('skipped');
    // The first file must be back where it started; a half-moved book is not acceptable.
    expect(await readFile(plan.files[0].from, 'utf8')).toBe('book');
    expect(await pathExists(plan.files[0].to)).toBe(false);
    expect(applyBookMove).not.toHaveBeenCalled();
  });

  it('restores files when the transaction throws', async () => {
    const plan = makePlan();
    await writeFile(plan.files[0].from, 'book');
    applyBookMove.mockRejectedValue(new Error('deadlock detected'));

    const result = await executor.execute({ plan, target: makeTarget() });

    expect(result).toMatchObject({ status: 'failed', reason: 'deadlock detected' });
    expect(await readFile(plan.files[0].from, 'utf8')).toBe('book');
    expect(await pathExists(plan.files[0].to)).toBe(false);
  });

  it('restores files when the book disappeared before the transaction', async () => {
    const plan = makePlan();
    await writeFile(plan.files[0].from, 'book');
    applyBookMove.mockResolvedValue({ moved: false, mergedBookId: null });

    const result = await executor.execute({ plan, target: makeTarget() });

    expect(result).toMatchObject({ status: 'skipped' });
    expect(await readFile(plan.files[0].from, 'utf8')).toBe('book');
  });
});

describe('watcher suppression', () => {
  it('suppresses both roots during the move and releases afterwards', async () => {
    const plan = makePlan();
    await writeFile(plan.files[0].from, 'x');

    const suppressedDuringMove: boolean[] = [];
    applyBookMove.mockImplementation(() => {
      suppressedDuringMove.push(registry.isSuppressed(plan.files[0].from), registry.isSuppressed(plan.files[0].to));
      return Promise.resolve({ moved: true, mergedBookId: null });
    });

    await executor.execute({ plan, target: makeTarget() });

    expect(suppressedDuringMove).toEqual([true, true]);
    expect(registry.isSuppressed(plan.files[0].from)).toBe(false);
    expect(registry.isSuppressed(plan.files[0].to)).toBe(false);
  });

  it('releases suppression even when the move fails', async () => {
    const plan = makePlan();
    await writeFile(plan.files[0].from, 'x');
    applyBookMove.mockRejectedValue(new Error('boom'));

    await executor.execute({ plan, target: makeTarget() });

    expect(registry.isSuppressed(plan.files[0].from)).toBe(false);
    expect(registry.isSuppressed(plan.files[0].to)).toBe(false);
  });
});

describe('locking', () => {
  it('serializes concurrent moves of the same book', async () => {
    const plan = makePlan();
    await writeFile(plan.files[0].from, 'x');

    const order: string[] = [];
    applyBookMove.mockImplementation(async () => {
      order.push('enter');
      await new Promise((resolve) => setTimeout(resolve, 15));
      order.push('exit');
      return { moved: true, mergedBookId: null };
    });

    await Promise.all([executor.execute({ plan, target: makeTarget() }), executor.execute({ plan, target: makeTarget() })]);

    // Never interleaved: the second attempt only starts after the first finished.
    expect(order).toEqual(['enter', 'exit']);
  });
});
