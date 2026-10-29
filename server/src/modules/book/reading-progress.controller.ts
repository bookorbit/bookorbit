import { BadRequestException, Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Put, Query } from '@nestjs/common';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { ReadingProgressQueryDto, ReadingProgressWritesDto } from './dto/reading-progress.dto';
import { ReadingProgressService } from './reading-progress.service';

@Controller('reading-progress')
export class ReadingProgressController {
  constructor(private readonly progress: ReadingProgressService) {}

  @Get()
  list(@Query() query: ReadingProgressQueryDto, @CurrentUser() user: RequestUser) {
    if (query.fileId != null && query.bookId == null) return this.progress.forFile(query.fileId, user);
    if (query.bookId != null && query.fileId == null) return this.progress.forBook(query.bookId, user);
    throw new BadRequestException('Pass exactly one of fileId or bookId');
  }

  @Put()
  save(@Body() dto: ReadingProgressWritesDto, @CurrentUser() user: RequestUser) {
    return this.progress.save(dto.writes, user);
  }

  @Delete(':fileId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async clear(@Param('fileId', ParseIntPipe) fileId: number, @CurrentUser() user: RequestUser) {
    await this.progress.clear(fileId, user);
  }
}
