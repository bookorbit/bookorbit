import { execFile } from 'child_process';
import { createReadStream } from 'fs';
import { mkdir, stat } from 'fs/promises';
import { join } from 'path';
import { promisify } from 'util';

import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import type { FastifyReply } from 'fastify';
import { NodePgDatabase } from 'drizzle-orm/node-postgres';

import { DB } from '../../../db/db.module';
import * as schema from '../../../db/schema';
import { KoboBookAccessService } from './kobo-book-access.service';
import { KepubifyBinaryService } from './kepubify-binary.service';
import { KoboSettingsService } from './kobo-settings.service';

type Db = NodePgDatabase<typeof schema>;

const execFileAsync = promisify(execFile);

const MIME: Record<string, string> = {
  epub: 'application/epub+zip',
  pdf: 'application/pdf',
};

@Injectable()
export class KoboDownloadService {
  private readonly logger = new Logger(KoboDownloadService.name);
  private readonly appDataPath: string;
  private readonly kepubCachePath: string;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
    private readonly kepubifyBinaryService: KepubifyBinaryService,
    private readonly settingsService: KoboSettingsService,
    private readonly bookAccessService: KoboBookAccessService,
  ) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
    this.kepubCachePath = join(this.appDataPath, '.kepub-cache');
  }

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

    if (format === 'epub') {
      const settings = await this.settingsService.getSettings(userId);
      const limitBytes = settings.kepubConversionLimitMb * 1024 * 1024;
      const withinLimit = !file.sizeBytes || file.sizeBytes <= limitBytes;
      if (settings.convertToKepub && withinLimit) {
        return this.streamKepub(file.absolutePath, file.hash ?? 'nohash', bookId, file.id, settings.forceEnableHyphenation, reply);
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
    const cacheDir = join(this.kepubCachePath, String(bookId));
    const cacheKey = hyphenate ? `${fileHash}-hyph` : fileHash;
    const cachedPath = join(cacheDir, `${cacheKey}.kepub.epub`);

    try {
      await stat(cachedPath);
      return this.streamFile(cachedPath, fileId, 'kepub.epub', reply);
    } catch {
      // Cache miss - convert
    }

    try {
      const binaryPath = await this.kepubifyBinaryService.getBinaryPath();
      await mkdir(cacheDir, { recursive: true });
      const args = hyphenate ? ['--hyphenate', '--output', cachedPath, sourcePath] : ['--output', cachedPath, sourcePath];
      await execFileAsync(binaryPath, args);
      return this.streamFile(cachedPath, fileId, 'kepub.epub', reply);
    } catch (err) {
      this.logger.warn(`kepubify conversion failed for book ${bookId}, falling back to EPUB: ${(err as Error).message}`);
      return this.streamFile(sourcePath, fileId, 'epub', reply);
    }
  }
}
