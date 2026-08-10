import { Injectable, Logger } from '@nestjs/common';
import { dirname, relative } from 'path';

import { SelfWriteRegistry } from '../../common/services/self-write-registry.service';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { FileLockService, bookOperationLockKey } from '../file-write/file-lock.service';
import type { BookMovePlan, PlannedFileMove } from './book-move-planner.service';
import type { BookFileMoveUpdate, MoveTargetLibrary } from './book-move.repository';
import { BookMoveRepository } from './book-move.repository';
import { buildSuppressionPaths, moveFile, moveFileBack, pathExists, removeEmptyDirs } from './book-move.utils';

const MOVE_EVENT = 'book_move.book';

export interface ExecuteMoveInput {
  plan: BookMovePlan;
  target: MoveTargetLibrary;
  /** Target book replaced by this move, when resolving a duplicate with "merge". */
  mergeDuplicateBookId?: number | null;
}

export type ExecuteMoveResult =
  | { status: 'success'; crossDevice: boolean }
  | { status: 'merged'; crossDevice: boolean; mergedBookId: number | null }
  | { status: 'skipped'; reason: string }
  | { status: 'failed'; reason: string };

interface CompletedMove {
  from: string;
  to: string;
  file: PlannedFileMove;
  ino: bigint;
  sizeBytes: number;
  mtime: Date;
}

/**
 * Moves a single book's files and then commits the database change.
 *
 * Filesystem first, database second, which is the opposite of the rename service.
 * The watcher is quiet for the duration (stopped plus self-write suppression), so
 * the database no longer has to win a race against it, and doing the write last
 * lets the transaction record the post-move inode, size and mtime. That matters for
 * cross-device moves, where the inode changes and stale stat values would make the
 * watcher's `fileStateMatches` check fail and trigger pointless rescans. It also
 * means a crash between the two steps leaves the files at the destination, which is
 * the direction the scanner's existing adoption logic already repairs.
 */
@Injectable()
export class BookMoveExecutorService {
  private readonly logger = new Logger(BookMoveExecutorService.name);

  constructor(
    private readonly moveRepo: BookMoveRepository,
    private readonly lockService: FileLockService,
    private readonly selfWriteRegistry: SelfWriteRegistry,
  ) {}

  async execute(input: ExecuteMoveInput): Promise<ExecuteMoveResult> {
    return this.lockService.withLock(bookOperationLockKey(input.plan.bookId), () => this.executeLocked(input));
  }

  private async executeLocked(input: ExecuteMoveInput): Promise<ExecuteMoveResult> {
    const { plan, target } = input;
    const startedAt = Date.now();

    const suppressionPaths = buildSuppressionPaths({
      sourcePaths: plan.files.map((file) => file.from),
      targetPaths: plan.files.map((file) => file.to),
      sourceFolderPath: plan.sourceFolderPath,
      targetFolderPath: plan.targetFolderPathKey,
      roots: [plan.sourceLibraryFolderPath, target.folderPath],
    });

    this.selfWriteRegistry.begin(suppressionPaths);

    const completed: CompletedMove[] = [];
    let crossDevice = false;

    try {
      for (const file of plan.files) {
        if (!(await pathExists(file.from))) {
          await this.rollback(completed, plan.bookId);
          return { status: 'skipped', reason: `source file is missing: ${file.from}` };
        }
        if (await pathExists(file.to)) {
          await this.rollback(completed, plan.bookId);
          return { status: 'skipped', reason: `destination already exists: ${file.to}` };
        }

        const outcome = await moveFile(file.from, file.to);
        crossDevice = crossDevice || outcome.crossDevice;
        completed.push({
          from: file.from,
          to: file.to,
          file,
          ino: outcome.stat.ino,
          sizeBytes: outcome.stat.sizeBytes,
          mtime: outcome.stat.mtime,
        });
      }

      const fileUpdates: BookFileMoveUpdate[] = completed.map((move) => ({
        fileId: move.file.fileId,
        absolutePath: move.to,
        relPath: relative(target.folderPath, move.to),
        ino: move.ino,
        sizeBytes: move.sizeBytes,
        mtime: move.mtime,
      }));

      const applied = await this.moveRepo.applyBookMove({
        bookId: plan.bookId,
        targetLibraryId: target.libraryId,
        targetFolderId: target.folderId,
        targetFolderPathKey: plan.targetFolderPathKey,
        fileUpdates,
        mergeDuplicateBookId: input.mergeDuplicateBookId ?? null,
      });

      if (!applied.moved) {
        await this.rollback(completed, plan.bookId);
        return { status: 'skipped', reason: 'book no longer exists' };
      }

      await this.cleanupSourceDirectories(plan);

      this.logger.log(
        `[${MOVE_EVENT}] [end] bookId=${plan.bookId} fromLibraryId=${plan.sourceLibraryId} toLibraryId=${target.libraryId} ` +
          `fileCount=${completed.length} crossDevice=${crossDevice} durationMs=${Date.now() - startedAt} - book moved`,
      );

      if (applied.mergedBookId != null) {
        return { status: 'merged', crossDevice, mergedBookId: applied.mergedBookId };
      }
      return { status: 'success', crossDevice };
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `[${MOVE_EVENT}] [fail] bookId=${plan.bookId} fromLibraryId=${plan.sourceLibraryId} toLibraryId=${target.libraryId} ` +
          `durationMs=${Date.now() - startedAt} errorClass=${errorClass} error="${sanitizeLogValue(message)}" - book move failed`,
      );

      await this.rollback(completed, plan.bookId);
      return { status: 'failed', reason: message };
    } finally {
      this.selfWriteRegistry.end(suppressionPaths);
    }
  }

  /** Returns already-moved files to their original locations. Best effort, always logged. */
  private async rollback(completed: CompletedMove[], bookId: number): Promise<void> {
    for (const move of [...completed].reverse()) {
      try {
        await moveFileBack(move.to, move.from);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(
          `[${MOVE_EVENT}] [fail] bookId=${bookId} from="${sanitizeLogValue(move.to)}" to="${sanitizeLogValue(move.from)}" ` +
            `error="${sanitizeLogValue(message)}" - rollback failed, file left at destination`,
        );
      }
    }
  }

  private async cleanupSourceDirectories(plan: BookMovePlan): Promise<void> {
    const directories = new Set<string>();
    for (const file of plan.files) directories.add(dirname(file.from));
    if (plan.sourceHasOwnFolder) directories.add(plan.sourceFolderPath);

    for (const directory of directories) {
      await removeEmptyDirs(directory, plan.sourceLibraryFolderPath);
    }
  }
}
