import { Permission } from '@projectx/types';
import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, Req, Res } from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyRequest, FastifyReply } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CoverService } from './cover.service';
import { UploadCoverFromUrlDto } from './dto/upload-cover-from-url.dto';

type MultipartRequest = FastifyRequest & { file: () => Promise<MultipartFile | undefined> };

@Controller('books')
export class CoverController {
  constructor(private readonly coverService: CoverService) {}

  @Get('cover/search')
  @RequirePermission(Permission.LibraryEditMetadata)
  async searchCovers(@Query('title') title: string, @Query('author') author?: string, @Query('isAudiobook') isAudiobook?: string) {
    return this.coverService.searchCovers({
      title,
      author,
      isAudiobook: isAudiobook === 'true',
    });
  }

  @Get('cover/proxy')
  @RequirePermission(Permission.LibraryEditMetadata)
  async proxyImage(@Query('url') url: string, @Res() res: FastifyReply) {
    const { buffer, contentType } = await this.coverService.proxyImage(url);
    res.type(contentType).send(buffer);
  }

  @Post(':id/cover')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.LibraryEditMetadata)
  async uploadCover(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser, @Req() req: MultipartRequest) {
    const data = await req.file();
    if (!data) throw new BadRequestException('No file provided');
    const buffer = await data.toBuffer();
    await this.coverService.uploadCover(id, buffer, data.mimetype, user);
  }

  @Post(':id/cover/from-url')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.LibraryEditMetadata)
  uploadCoverFromUrl(@Param('id', ParseIntPipe) id: number, @Body() dto: UploadCoverFromUrlDto, @CurrentUser() user: RequestUser) {
    return this.coverService.uploadCoverFromUrl(id, dto.url, user);
  }

  @Delete(':id/cover')
  @RequirePermission(Permission.LibraryEditMetadata)
  async deleteCover(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    const coverSource = await this.coverService.deleteCover(id, user);
    return { coverSource };
  }
}
