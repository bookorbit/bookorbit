import { Permission } from '@bookorbit/types';
import { BadRequestException, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { MultipartRequest } from '../../common/types/multipart-request';
import type { RequestUser } from '../../common/types/request-user';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { UploadService } from './upload.service';

@Controller('libraries')
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly appSettings: AppSettingsService,
  ) {}

  @Post(':id/upload')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(Permission.LibraryUpload)
  async uploadBook(
    @Param('id', ParseIntPipe) libraryId: number,
    @Query('folderId') rawFolderId: string | undefined,
    @CurrentUser() user: RequestUser,
    @Req() req: MultipartRequest,
  ) {
    // Override the global multipart fileSize limit for book uploads.
    // Per-request options are deep-merged with plugin defaults (busboy config),
    // so this fileSize takes precedence over the global 20 MB cover limit.
    const limitMb = await this.appSettings.getMaxUploadSizeMb();
    const data = await req.file({ limits: { fileSize: limitMb * 1024 * 1024 } });
    if (!data) throw new BadRequestException('No file provided');

    const folderId = this.parseFolderId(rawFolderId);

    return this.uploadService.upload(libraryId, folderId, data.filename, data.file, user);
  }

  private parseFolderId(rawFolderId: string | undefined): number | undefined {
    if (rawFolderId === undefined) return undefined;

    const value = rawFolderId.trim();
    if (!/^\d+$/.test(value)) {
      throw new BadRequestException('Invalid folderId');
    }

    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed <= 0) {
      throw new BadRequestException('Invalid folderId');
    }

    return parsed;
  }
}
