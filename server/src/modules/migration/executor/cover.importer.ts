import { Injectable, Logger } from '@nestjs/common';
import { readFile, realpath } from 'fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'path';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { MigrationRepository } from '../migration.repository';
import { BookCoverStore } from '../../book-cover-store/book-cover-store.service';
import type { PlannerResult } from '../planner/planner.types';
import { type RunStateCheck, emptyCounters, hasErrorCode } from './executor-utils';

const COVER_CONCURRENCY = 10;

@Injectable()
export class CoverImporter {
  private readonly logger = new Logger(CoverImporter.name);

  constructor(
    private readonly repo: MigrationRepository,
    private readonly coverStore: BookCoverStore,
  ) {}

  async import(
    runId: number,
    planned: PlannerResult,
    _appDataPath: string,
    sourceMediaRootPath: string | null,
    ensureRunning: RunStateCheck,
  ): Promise<void> {
    const counters = emptyCounters();
    const matches = planned.execution.matchedBooks;

    if (!sourceMediaRootPath) {
      counters.processed = matches.length;
      counters.skipped = matches.length;
      await this.repo.setRunMetric(runId, 'book_covers', 'book_covers', counters);
      return;
    }

    for (let i = 0; i < matches.length; i += COVER_CONCURRENCY) {
      await ensureRunning();
      const batch = matches.slice(i, i + COVER_CONCURRENCY);

      const results = await Promise.allSettled(batch.map((match) => this.processSingleMatch(runId, match, sourceMediaRootPath)));

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        counters.processed += 1;
        if (result.status === 'fulfilled') {
          counters[result.value] += 1;
        } else {
          counters.failed += 1;
        }
      }
    }

    await this.repo.setRunMetric(runId, 'book_covers', 'book_covers', counters);
  }

  private async processSingleMatch(
    runId: number,
    match: { sourceBookId: string; targetBookId: number },
    sourceMediaRootPath: string,
  ): Promise<'imported' | 'unresolved' | 'failed'> {
    const imagesRoot = resolve(sourceMediaRootPath, 'images');
    const sourceImageDir = resolve(imagesRoot, match.sourceBookId);
    const relativeSourceDir = relative(imagesRoot, sourceImageDir);
    if (!relativeSourceDir || relativeSourceDir.startsWith('..') || resolve(imagesRoot, relativeSourceDir) !== sourceImageDir) return 'unresolved';
    const sourceCoverPath = await this.resolveSafeCoverPath(imagesRoot, sourceImageDir);
    if (!sourceCoverPath) return 'unresolved';
    const coverBytes = await this.readOptionalFile(sourceCoverPath);
    if (!coverBytes) return 'unresolved';

    try {
      await this.importSingleCover(match.targetBookId, coverBytes);
      return 'imported';
    } catch (error) {
      const errorClass = error instanceof Error ? error.name : 'Error';
      const message = sanitizeLogValue(error instanceof Error ? error.message : String(error));
      const sourceBookId = sanitizeLogValue(match.sourceBookId);
      this.logger.warn(
        `[migration.cover] [fail] runId=${runId} sourceBookId="${sourceBookId}" targetBookId=${match.targetBookId} errorClass=${errorClass} error="${message}" - cover import failed`,
      );
      return 'failed';
    }
  }

  private async importSingleCover(targetBookId: number, coverBytes: Buffer): Promise<void> {
    const medium = await this.coverStore.chooseWriteMedium(targetBookId, coverBytes);
    await this.coverStore.saveCustom(targetBookId, medium, coverBytes, { origin: 'legacy' });
  }

  private async readOptionalFile(path: string): Promise<Buffer | null> {
    try {
      return await readFile(path);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return null;
      throw error;
    }
  }

  private async resolveSafeCoverPath(imagesRoot: string, sourceImageDir: string): Promise<string | null> {
    try {
      const [realImagesRoot, realSourceDir] = await Promise.all([realpath(imagesRoot), realpath(sourceImageDir)]);
      if (!this.isContainedPath(realImagesRoot, realSourceDir)) return null;
      const realCoverPath = await realpath(join(realSourceDir, 'cover.jpg'));
      return this.isContainedPath(realSourceDir, realCoverPath) ? realCoverPath : null;
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT') || hasErrorCode(error, 'ENOTDIR')) return null;
      throw error;
    }
  }

  private isContainedPath(root: string, target: string): boolean {
    const relativePath = relative(root, target);
    return relativePath !== '' && relativePath !== '..' && !relativePath.startsWith(`..${sep}`) && !isAbsolute(relativePath);
  }
}
