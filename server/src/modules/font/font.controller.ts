import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { createReadStream } from 'fs';

import { FONT_FORMAT_MIME_TYPES, MAX_FONT_FILE_SIZE, Permission } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { ForbidPermission } from '../../common/decorators/forbid-permission.decorator';
import type { MultipartRequest } from '../../common/types/multipart-request';
import type { RequestUser } from '../../common/types/request-user';
import { FontService } from './font.service';
import { RenameFontFamilyDto } from './dto/rename-font-family.dto';
import { UpdateFontDto } from './dto/update-font.dto';

@Controller('fonts')
export class FontController {
  constructor(private readonly fontService: FontService) {}

  @Get()
  async list(@CurrentUser() user: RequestUser) {
    return this.fontService.list(user.id);
  }

  /** How this reader uses each custom font, so the Fonts page can say what removing or hiding one costs. */
  @Get('usage')
  async usage(@CurrentUser() user: RequestUser) {
    return this.fontService.usage(user.id);
  }

  @Patch('families')
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot manage fonts')
  async renameFamily(@Body() dto: RenameFontFamilyDto, @CurrentUser() user: RequestUser) {
    return this.fontService.renameFamily(user, dto.familyName, dto.newFamilyName);
  }

  @Post('upload')
  @HttpCode(HttpStatus.CREATED)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot manage fonts')
  async upload(@CurrentUser() user: RequestUser, @Req() req: MultipartRequest) {
    const data = await req.file({ limits: { fileSize: MAX_FONT_FILE_SIZE } });
    if (!data) throw new BadRequestException('No file provided');
    const buffer = await data.toBuffer();
    return this.fontService.upload(user, buffer, data.filename);
  }

  @Patch(':id')
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot manage fonts')
  async update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateFontDto, @CurrentUser() user: RequestUser) {
    return this.fontService.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ForbidPermission(Permission.DemoRestricted, 'Demo-restricted account cannot manage fonts')
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
