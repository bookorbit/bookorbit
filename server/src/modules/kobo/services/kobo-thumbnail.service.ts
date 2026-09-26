import { Injectable, NotFoundException } from '@nestjs/common';
import { stat } from 'fs/promises';
import { createReadStream } from 'fs';
import type { FastifyReply } from 'fastify';
import { imageContentTypeFromPath } from '../../../common/image-content-type';
import { KoboBookAccessService } from './kobo-book-access.service';
import { BookCoverStore } from '../../book-cover-store/book-cover-store.service';

@Injectable()
export class KoboThumbnailService {
  constructor(
    private readonly bookAccessService: KoboBookAccessService,
    private readonly coverStore: BookCoverStore,
  ) {}

  async serveThumbnail(userId: number, bookId: number, ifNoneMatch: string | undefined, reply: FastifyReply) {
    await this.bookAccessService.assertBookAccessible(userId, bookId);

    const thumbnailPath = await this.coverStore.resolve(bookId, { medium: 'ebook', variant: 'thumbnail' });
    try {
      if (!thumbnailPath) throw new NotFoundException('No thumbnail');
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
    try {
      const coverPath = await this.coverStore.resolve(bookId, { medium: 'ebook', variant: 'cover' });
      if (!coverPath) throw new NotFoundException('No cover');
      const { mtimeMs } = await stat(coverPath);
      const etag = `"${Math.floor(mtimeMs)}"`;
      if (ifNoneMatch === etag) {
        reply.status(304).send();
        return;
      }
      reply.header('Cache-Control', 'max-age=86400');
      reply.header('ETag', etag);
      reply.type(imageContentTypeFromPath(coverPath));
      reply.send(createReadStream(coverPath));
    } catch {
      throw new NotFoundException('No cover image');
    }
  }
}
