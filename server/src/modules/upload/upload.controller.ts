import { BadRequestException, Body, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Query, Req } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { MultipartRequest } from '../../common/types/multipart-request';
import type { RequestUser } from '../../common/types/request-user';
import { AppSettingsService } from '../app-settings/app-settings.service';
import { UploadService } from './upload.service';

@Controller('books')
export class UploadController {
  constructor(
    private readonly uploadService: UploadService,
    private readonly appSettings: AppSettingsService,
  ) {}

  @Post(':libraryId')
  @RequirePermission(Permission.LibraryUpload)
  async uploadBook(
    @Param('libraryId', ParseIntPipe) libraryId: number,
    @Query('folderId') folderIdStr: string | undefined,
    @CurrentUser() user: RequestUser,
    @Req() req: MultipartRequest,
  ) {
    let folderId: number | undefined;

    if (folderIdStr !== undefined) {
      const parsed = Number(folderIdStr.trim());
      if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new BadRequestException('Invalid folderId');
      }
      folderId = parsed;
    }

    const maxUploadSizeMb = await this.appSettings.getMaxUploadSizeMb();
    const file = await req.file({ limits: { fileSize: maxUploadSizeMb * 1024 * 1024 } });

    if (!file) {
      throw new BadRequestException('No multipart file provided');
    }

    return this.uploadService.upload(libraryId, folderId, file.filename, file.file, user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(Permission.LibraryUpload)
  async createManualBook(@Body() body: { libraryId: number; title: string; author?: string; isbn13?: string }, @CurrentUser() user: RequestUser) {
    if (!body.libraryId) {
      throw new BadRequestException('Library ID is required');
    }
    return this.uploadService.createManualBook(body.libraryId, body, user);
  }
}
