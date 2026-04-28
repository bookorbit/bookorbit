import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { createReadStream } from 'fs';

import { FONT_FORMAT_MIME_TYPES, MAX_FONT_FILE_SIZE } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { MultipartRequest } from '../../common/types/multipart-request';
import type { RequestUser } from '../../common/types/request-user';
import { FontService } from './font.service';
import { UpdateFontDto } from './dto/update-font.dto';

@Controller('fonts')
export class FontController {
  constructor(private readonly fontService: FontService) {}

  @Get()
  async list(@CurrentUser() user: RequestUser) {
    return this.fontService.list(user.id);
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  async upload(@CurrentUser() user: RequestUser, @Req() req: MultipartRequest) {
    const data = await req.file({ limits: { fileSize: MAX_FONT_FILE_SIZE } });
    if (!data) throw new BadRequestException('No file provided');
    const buffer = await data.toBuffer();
    return this.fontService.upload(user, buffer, data.filename);
  }

  @Patch(':id')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFontDto, @CurrentUser() user: RequestUser) {
    return this.fontService.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    await this.fontService.remove(user, id);
  }

  @Get(':id/file')
  async serveFile(
    @Param('id', ParseIntPipe) id: number,
    @CurrentUser() user: RequestUser,
    @Req() req: { headers: Record<string, string | undefined> },
    @Res() reply: FastifyReply,
  ) {
    const { filePath, font } = await this.fontService.getFileInfo(user, id);

    const etag = `"${font.fileHash}"`;
    if (req.headers['if-none-match'] === etag) {
      reply.status(304).send();
      return;
    }

    const mimeType = FONT_FORMAT_MIME_TYPES[font.format];
    reply.header('Content-Type', mimeType);
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    reply.header('ETag', etag);
    reply.send(createReadStream(filePath));
  }
}
