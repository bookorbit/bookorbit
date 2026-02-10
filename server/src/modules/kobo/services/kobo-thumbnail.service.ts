import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readdir, stat } from 'fs/promises';
import { createReadStream } from 'fs';
import { join } from 'path';
import type { FastifyReply } from 'fastify';

@Injectable()
export class KoboThumbnailService {
  private readonly booksPath: string;

  constructor(private readonly config: ConfigService) {
    this.booksPath = this.config.get<string>('storage.booksPath')!;
  }

  async serveThumbnail(bookId: number, ifNoneMatch: string | undefined, reply: FastifyReply) {
    const thumbnailPath = join(this.booksPath, 'covers', String(bookId), 'thumbnail.jpg');
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
    const dir = join(this.booksPath, 'covers', String(bookId));
    try {
      const files = await readdir(dir);
      const cover = files.find((f) => f.startsWith('cover.'));
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
