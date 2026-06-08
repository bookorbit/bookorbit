import { BadRequestException, Controller, HttpCode, HttpStatus, Param, ParseIntPipe, Post, Req } from '@nestjs/common';
import { Permission } from '@bookorbit/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { RequirePermission } from '../../common/decorators/require-permission.decorator';
import type { MultipartRequest } from '../../common/types/multipart-request';
import type { RequestUser } from '../../common/types/request-user';
import { MAX_UPLOAD_BYTES } from './upload-storage.service';
import { UploadService } from './upload.service';

@Controller('books')
export class BookFileUploadController {
  constructor(private readonly uploadService: UploadService) {}

  @Post(':id/files')
  @HttpCode(HttpStatus.CREATED)
  @RequirePermission(Permission.LibraryUpload)
  async addFileToBook(@Param('id', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser, @Req() req: MultipartRequest) {
    const data = await req.file({ limits: { fileSize: MAX_UPLOAD_BYTES } });
    if (!data) throw new BadRequestException('No file provided');
    return this.uploadService.addFileToBook(bookId, data.filename, data.file, user);
  }

  @Post(':id/rename-files')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermission(Permission.LibraryEditMetadata)
  async renameBookFiles(@Param('id', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser): Promise<void> {
    await this.uploadService.renameBookFiles(bookId, user);
  }
}
