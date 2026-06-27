import { createReadStream } from 'fs';
import { stat } from 'fs/promises';

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { sanitizeLogValue } from '../../../common/utils/log-sanitize.utils';
import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';
import { KoboBookAccessService } from './kobo-book-access.service';
import { KepubConversionService } from './kepub-conversion.service';
import { KoboSettingsService } from './kobo-settings.service';

type Db = NodePgDatabase<typeof schema>;

const MIME: Record<string, string> = {
  epub: 'application/epub+zip',
  'kepub.epub': 'application/epub+zip',
  pdf: 'application/pdf',
};

@Injectable()
export class KoboDownloadService {
  private readonly logger = new Logger(KoboDownloadService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly kepubConversionService: KepubConversionService,
    private readonly settingsService: KoboSettingsService,
    private readonly bookAccessService: KoboBookAccessService,
  ) {}

  async streamBook(userId: number, bookId: number, reply: FastifyReply) {
    const book = await this.db.query.books.findFirst({ where: eq(schema.books.id, bookId) });
    if (!book) throw new NotFoundException('Book not found');

    await this.bookAccessService.assertBookAccessible(userId, bookId);

    const file = await this.db.query.bookFiles.findFirst({
      where: and(eq(schema.bookFiles.bookId, bookId), eq(schema.bookFiles.id, book.primaryFileId ?? -1)),
    });

    if (!file) throw new NotFoundException('No file found for this book');

    const format = (file.format ?? 'epub').toLowerCase();

    if (format === 'pdf') {
      return this.streamFile(file.absolutePath, file.id, format, reply);
    }

    if (format === 'kepub') {
      return this.streamFile(file.absolutePath, file.id, 'kepub.epub', reply);
    }

    if (format === 'epub') {
      const settings = await this.settingsService.getSettings(userId);
      const limitBytes = settings.kepubConversionLimitMb * 1024 * 1024;
      const withinLimit = !file.sizeBytes || file.sizeBytes <= limitBytes;
      if (settings.convertToKepub && withinLimit) {
        return this.streamKepub(file.absolutePath, file.fileHash ?? 'nohash', bookId, file.id, settings.forceEnableHyphenation, reply);
      }
    }

    return this.streamFile(file.absolutePath, file.id, format, reply);
  }

  private async streamFile(absolutePath: string, fileId: number, format: string, reply: FastifyReply) {
    try {
      const { size } = await stat(absolutePath);
      reply.header('Content-Length', size);
      reply.header('Content-Disposition', `attachment; filename="book-${fileId}.${format}"`);
      reply.type(MIME[format] ?? 'application/octet-stream');
      reply.send(createReadStream(absolutePath));
    } catch {
      throw new NotFoundException('File not found on disk');
    }
  }

  private async streamKepub(sourcePath: string, fileHash: string, bookId: number, fileId: number, hyphenate: boolean, reply: FastifyReply) {
    const start = Date.now();
    try {
      const cachedPath = await this.kepubConversionService.getKepubPath({ sourcePath, fileHash, bookId, hyphenate });
      return this.streamFile(cachedPath, fileId, 'kepub.epub', reply);
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.logger.warn(
        `[kobo.download] [fail] bookId=${bookId} fileId=${fileId} durationMs=${Date.now() - start} errorClass=${error.constructor.name} error="${sanitizeLogValue(error.message)}" - kepub conversion failed, falling back to epub`,
      );
      return this.streamFile(sourcePath, fileId, 'epub', reply);
    }
  }
}
