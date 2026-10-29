import { Controller, Get, NotFoundException, Param, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';

import { MetadataHttpProviderService } from './metadata-http-provider.service';

/**
 * External providers' icons, for every signed-in user: they appear wherever a provider does,
 * search results and book pages included, not only in the settings that register providers.
 */
@Controller('metadata-providers')
export class MetadataProviderIconController {
  constructor(private readonly providers: MetadataHttpProviderService) {}

  @Get(':key/icon')
  async icon(
    @Param('key') key: string,
    @Query('v') version: string | undefined,
    @Req() req: { headers: Record<string, string | undefined> },
    @Res() reply: FastifyReply,
  ) {
    const icon = await this.providers.findIcon(key);
    if (!icon) throw new NotFoundException(`No icon for metadata provider ${key}`);
    const etag = `"${icon.hash}"`;
    if (req.headers['if-none-match'] === etag) {
      reply.status(304).send();
      return;
    }
    reply.header('Content-Type', icon.contentType);
    reply.header('ETag', etag);
    // A versioned URL changes whenever the image does, so it can be kept for good.
    reply.header('Cache-Control', version === icon.hash ? 'private, max-age=31536000, immutable' : 'private, max-age=3600');
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('Content-Security-Policy', "default-src 'none'; sandbox");
    reply.send(icon.data);
  }
}
