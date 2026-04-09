import { Injectable, Logger } from '@nestjs/common';
import { constants as fsConstants } from 'fs';
import { access, mkdir, readdir, readFile, unlink, writeFile } from 'fs/promises';
import { join } from 'path';

import type { CoverRefreshedEvent } from '@projectx/types';
import { COVER_CUSTOM_FILE_PREFIX, COVER_THUMBNAIL_FILE_NAME, bookCoverDirPath } from '../../../common/book-cover-storage';
import { generateThumbnail, imageExt } from '../../metadata/lib/cover';
import { MigrationRepository } from '../migration.repository';
import { MigrationImportRepository } from './migration-import.repository';
import { ScanGateway } from '../../scanner/scan.gateway';
import type { PlannerResult } from '../planner/planner.types';
import { type RunStateCheck, emptyCounters, hasErrorCode } from './executor-utils';

const COVER_CONCURRENCY = 10;

@Injectable()
export class CoverImporter {
  private readonly logger = new Logger(CoverImporter.name);

  constructor(
    private readonly repo: MigrationRepository,
    private readonly importRepo: MigrationImportRepository,
    private readonly scanGateway: ScanGateway,
  ) {}

  async import(
    runId: number,
    planned: PlannerResult,
    appDataPath: string,
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

    const libraryIdByBookId = await this.importRepo.fetchLibraryIdsByBookIds(matches.map((m) => m.targetBookId));

    for (let i = 0; i < matches.length; i += COVER_CONCURRENCY) {
      await ensureRunning();
      const batch = matches.slice(i, i + COVER_CONCURRENCY);

      const results = await Promise.allSettled(batch.map((match) => this.processSingleMatch(runId, match, appDataPath, sourceMediaRootPath)));

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        const match = batch[j];
        counters.processed += 1;
        if (result.status === 'fulfilled') {
          counters[result.value] += 1;
          if (result.value === 'imported') {
            const libraryId = libraryIdByBookId.get(match.targetBookId);
            if (libraryId) {
              this.scanGateway.emitCoverRefreshed({ bookId: match.targetBookId, libraryId } satisfies CoverRefreshedEvent);
            }
          }
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
    appDataPath: string,
    sourceMediaRootPath: string,
  ): Promise<'imported' | 'unresolved' | 'failed'> {
    const sourceImageDir = join(sourceMediaRootPath, 'images', match.sourceBookId);
    const sourceCoverPath = join(sourceImageDir, 'cover.jpg');
    const sourceThumbnailPath = join(sourceImageDir, 'thumbnail.jpg');
    const coverBytes = await this.readOptionalFile(sourceCoverPath);
    if (!coverBytes) return 'unresolved';

    try {
      await this.importSingleCover(match.targetBookId, appDataPath, coverBytes, sourceThumbnailPath);
      return 'imported';
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[migration.cover] runId=${runId} sourceBookId=${match.sourceBookId} targetBookId=${match.targetBookId} error="${message}"`);
      return 'failed';
    }
  }

  private async importSingleCover(targetBookId: number, appDataPath: string, coverBytes: Buffer, sourceThumbnailPath: string): Promise<void> {
    const targetCoverDir = bookCoverDirPath(appDataPath, targetBookId);
    await mkdir(targetCoverDir, { recursive: true });
    await this.deleteFilesByPrefix(targetCoverDir, COVER_CUSTOM_FILE_PREFIX);

    const coverExt = imageExt(coverBytes);
    await writeFile(join(targetCoverDir, `${COVER_CUSTOM_FILE_PREFIX}${coverExt}`), coverBytes);

    const sourceThumbnailBytes = await this.readOptionalFile(sourceThumbnailPath);
    const thumbnailBytes = sourceThumbnailBytes ?? (await generateThumbnail(coverBytes));
    await writeFile(join(targetCoverDir, COVER_THUMBNAIL_FILE_NAME), thumbnailBytes);

    await this.importRepo.markCoverAsCustom(targetBookId);
  }

  private async readOptionalFile(path: string): Promise<Buffer | null> {
    try {
      return await readFile(path);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return null;
      throw error;
    }
  }

  private async deleteFilesByPrefix(dirPath: string, prefix: string): Promise<void> {
    const files = await this.readDirIfExists(dirPath);
    for (const fileName of files) {
      if (!fileName.startsWith(prefix)) continue;
      await this.removeFileIfPresent(join(dirPath, fileName));
    }
  }

  private async readDirIfExists(dirPath: string): Promise<string[]> {
    try {
      await access(dirPath, fsConstants.R_OK);
      return await readdir(dirPath);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return [];
      throw error;
    }
  }

  private async removeFileIfPresent(filePath: string): Promise<void> {
    try {
      await unlink(filePath);
    } catch (error) {
      if (hasErrorCode(error, 'ENOENT')) return;
      throw error;
    }
  }
}
