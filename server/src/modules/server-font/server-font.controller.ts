import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { createReadStream } from 'fs';

import { FONT_FORMAT_MIME_TYPES, MAX_FONT_FILE_SIZE, Permission } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbidPermission } from '../../common/decorators/forbid-permission.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { MultipartRequest } from '../../common/types/multipart-request';
import type { RequestUser } from '../../common/types/request-user';
import { UpdateFontDto } from '../font/dto/update-font.dto';
import { ServerFontService } from './server-font.service';

const CANNOT_MANAGE = 'Demo-restricted account cannot manage server fonts';

/**
 * Reads are open to every authenticated user because the web reader offers server fonts
 * to everyone; only writes require the app-settings permission.
 */
@Controller('server-fonts')
export class ServerFontController {
  constructor(private readonly serverFontService: ServerFontService) {}

  @Get()
  async list() {
    return this.serverFontService.list();
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(Permission.ManageAppSettings)
  @ForbidPermission(Permission.DemoRestricted, CANNOT_MANAGE)
  async upload(@CurrentUser() user: RequestUser, @Req() req: MultipartRequest) {
    const data = await req.file({ limits: { fileSize: MAX_FONT_FILE_SIZE } });
    if (!data) throw new BadRequestException('No file provided');
    const buffer = await data.toBuffer();
    return this.serverFontService.upload(user, buffer, data.filename);
  }

  @Patch(':id')
  @RequirePermission(Permission.ManageAppSettings)
  @ForbidPermission(Permission.DemoRestricted, CANNOT_MANAGE)
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFontDto) {
    return this.serverFontService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.ManageAppSettings)
  @ForbidPermission(Permission.DemoRestricted, CANNOT_MANAGE)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.serverFontService.remove(id);
  }

  @Get(':id/file')
  async serveFile(@Param('id', ParseIntPipe) id: number, @Req() req: { headers: Record<string, string | undefined> }, @Res() reply: FastifyReply) {
    const { filePath, font } = await this.serverFontService.getFileInfo(id);

    const etag = `"${font.fileHash}"`;
    if (req.headers['if-none-match'] === etag) {
      reply.status(304).send();
      return;
    }

    const mimeType = FONT_FORMAT_MIME_TYPES[font.format];
    reply.header('Content-Type', mimeType);
    // Identical for every user, but still behind auth, so shared caches must not keep it.
    reply.header('Cache-Control', 'private, max-age=31536000, immutable');
    reply.header('ETag', etag);
    reply.send(createReadStream(filePath));
  }
}
