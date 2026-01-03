import { Controller, Get, Param, ParseIntPipe, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { CbzService } from './cbz.service';

@Controller('cbz')
export class CbzController {
  constructor(private readonly cbzService: CbzService) {}

  @Get('files/:fileId/pages')
  async getPageCount(@Param('fileId', ParseIntPipe) fileId: number) {
    return { pageCount: await this.cbzService.getPageCount(fileId) };
  }

  @Get('files/:fileId/pages/:pageIndex')
  async getPage(@Param('fileId', ParseIntPipe) fileId: number, @Param('pageIndex', ParseIntPipe) pageIndex: number, @Res() reply: FastifyReply) {
    const { stream, mimeType } = await this.cbzService.streamPage(fileId, pageIndex);
    reply.header('Cache-Control', 'public, max-age=31536000, immutable');
    reply.type(mimeType);
    reply.send(stream);
  }
}
