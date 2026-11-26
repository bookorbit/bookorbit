import { BadRequestException, Body, Controller, Delete, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { MultipartRequest } from '../../common/types/multipart-request';
import type { RequestUser } from '../../common/types/request-user';
import { UPLOAD_CHUNK_SIZE_BYTES } from '../../common/constants/upload.constants';
import { CreateUploadSessionDto } from './dto/create-upload-session.dto';
import { UploadSessionService } from './upload-session.service';

@Controller('uploads')
export class UploadSessionController {
  constructor(private readonly sessions: UploadSessionService) {}

  @Get('capabilities')
  capabilities(@CurrentUser() user: RequestUser) {
    return this.sessions.capabilities(user);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateUploadSessionDto, @CurrentUser() user: RequestUser) {
    return this.sessions.create(dto, user);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.sessions.get(id, user);
  }

  @Post(':id/chunks')
  async appendChunk(
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('upload-offset') rawOffset: string | undefined,
    @Headers('upload-checksum') checksum: string | undefined,
    @CurrentUser() user: RequestUser,
    @Req() req: MultipartRequest,
  ) {
    const offset = parseOffset(rawOffset);
    const data = await req.file({ limits: { fileSize: UPLOAD_CHUNK_SIZE_BYTES } });
    if (!data) throw new BadRequestException('No chunk provided');
    return this.sessions.appendChunk(id, offset, checksum, data.file, user);
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.ACCEPTED)
  complete(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.sessions.complete(id, user);
  }

  @Delete(':id')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: RequestUser) {
    return this.sessions.cancel(id, user);
  }
}

function parseOffset(value: string | undefined): number {
  if (!value || !/^\d+$/.test(value)) throw new BadRequestException('Upload-Offset must be a non-negative integer');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) throw new BadRequestException('Upload-Offset is invalid');
  return parsed;
}
