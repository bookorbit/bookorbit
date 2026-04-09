import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { join } from 'path';
import type { FastifyReply } from 'fastify';
import { bookCoverDirPath, bookThumbnailPath, findPreferredBookCoverFileName } from '../../../common/book-cover-storage';
import { KoboBookAccessService } from './kobo-book-access.service';

@Injectable()
export class KoboThumbnailService {
  private readonly appDataPath: string;

  constructor(
    private readonly config: ConfigService,
    private readonly bookAccessService: KoboBookAccessService,
  ) {
    this.appDataPath = this.config.get<string>('storage.appDataPath')!;
  }

  async serveThumbnail(userId: number, bookId: number, ifNoneMatch: string | undefined, reply: FastifyReply) {
    await this.bookAccessService.assertBookAccessible(userId, bookId);

    const thumbnailPath = bookThumbnailPath(this.appDataPath, bookId);
    try {
      const { mtimeMs } = await stat(thumbnailPath);
      const etag = `"${Math.floor(mtimeMs)}"`;
      if (ifNoneMatch === etag) {
        reply.status(304).send();
        return;
      }
      reply.header('Cache-Control', 'max-age=86400');
      reply.header('ETag', etag);
      reply.type('image/jpeg');
      reply.send(createReadStream(thumbnailPath));
    } catch {
      await this.serveCover(bookId, ifNoneMatch, reply);
    }
  }

  async serveCover(bookId: number, ifNoneMatch: string | undefined, reply: FastifyReply) {
    const dir = bookCoverDirPath(this.appDataPath, bookId);
    try {
      const files = await readdir(dir);
      const cover = findPreferredBookCoverFileName(files);
      if (!cover) throw new NotFoundException('No cover');
      const coverPath = join(dir, cover);
      const { mtimeMs } = await stat(coverPath);
      const etag = `"${Math.floor(mtimeMs)}"`;
      if (ifNoneMatch === etag) {
        reply.status(304).send();
        return;
      }
      const ext = cover.split('.').pop()?.toLowerCase();
      reply.header('Cache-Control', 'max-age=86400');
      reply.header('ETag', etag);
      reply.type(ext === 'png' ? 'image/png' : 'image/jpeg');
      reply.send(createReadStream(coverPath));
    } catch {
      throw new NotFoundException('No cover image');
    }
  }
}
