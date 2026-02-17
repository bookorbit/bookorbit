import { BadRequestException, Body, Controller, Delete, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { CoverService } from './cover.service';
import { UploadCoverFromUrlDto } from './dto/upload-cover-from-url.dto';

type MultipartRequest = FastifyRequest & { file: () => Promise<MultipartFile | undefined> };

@Controller('books')
export class CoverController {
  constructor(private readonly coverService: CoverService) {}

  @Post(':id/cover')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('library_edit_metadata')
  async uploadCover(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser, @Req() req: MultipartRequest) {
    const data = await req.file();
    if (!data) throw new BadRequestException('No file provided');
    const buffer = await data.toBuffer();
    await this.coverService.uploadCover(id, buffer, data.mimetype, user);
  }

  @Post(':id/cover/from-url')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission('library_edit_metadata')
  uploadCoverFromUrl(@Param('id', ParseIntPipe) id: number, @Body() dto: UploadCoverFromUrlDto, @CurrentUser() user: RequestUser) {
    return this.coverService.uploadCoverFromUrl(id, dto.url, user);
  }

  @Delete(':id/cover')
  @RequirePermission('library_edit_metadata')
  async deleteCover(@Param('id', ParseIntPipe) id: number, @CurrentUser() user: RequestUser) {
    const coverSource = await this.coverService.deleteCover(id, user);
    return { coverSource };
  }
}
