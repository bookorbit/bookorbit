import { BadRequestException, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import type { MultipartFile } from '@fastify/multipart';
import type { FastifyRequest } from 'fastify';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { UploadService } from './upload.service';
import { MAX_UPLOAD_BYTES } from './upload-storage.service';

type MultipartRequest = FastifyRequest & {
  file: (opts?: object) => Promise<MultipartFile | undefined>;
};

@Controller('libraries')
export class UploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post(':id/upload')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission('library_upload')
  async uploadBook(
    @Param('id', ParseIntPipe) libraryId: number,
    @Query('folderId') rawFolderId: string | undefined,
    @CurrentUser() user: RequestUser,
    @Req() req: MultipartRequest,
  ) {
    // Override the global multipart fileSize limit for book uploads.
    // Per-request options are deep-merged with plugin defaults (busboy config),
    // so this fileSize takes precedence over the global 20 MB cover limit.
    const data = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    if (!data) throw new BadRequestException('No file provided');

    let folderId: number | undefined;
    if (rawFolderId !== undefined) {
      folderId = parseInt(rawFolderId, 10);
      if (isNaN(folderId)) throw new BadRequestException('Invalid folderId');
    }

    return this.uploadService.upload(libraryId, folderId, data.filename, data.file, user);
  }
}
