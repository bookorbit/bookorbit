import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post, Query } from '@nestjs/common';

import { CurrentUser } from '../../common/decorators/current-user.decorator';
import type { RequestUser } from '../../common/types/request-user';
import { AnnotationService } from './annotation.service';
import { CreateAnnotationDto } from './dto/create-annotation.dto';
import { UpdateAnnotationDto } from './dto/update-annotation.dto';
import { AnnotationQueryDto } from './dto/annotation-query.dto';

@Controller('books/:bookId/annotations')
export class AnnotationController {
  constructor(private readonly annotationService: AnnotationService) {}

  @Get()
  getAnnotations(@Param('bookId', ParseIntPipe) bookId: number, @CurrentUser() user: RequestUser, @Query() query: AnnotationQueryDto) {
    if (query.page != null) {
      return this.annotationService.getAnnotationsPaginated(bookId, user, query);
    }
    return this.annotationService.getAnnotations(bookId, user, query.readerFileId);
  }

  @Post()
  createAnnotation(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: CreateAnnotationDto, @CurrentUser() user: RequestUser) {
    return this.annotationService.createAnnotation(bookId, user, dto);
  }

  @Patch(':annotationId')
  updateAnnotation(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('annotationId', ParseIntPipe) annotationId: number,
    @Body() dto: UpdateAnnotationDto,
    @CurrentUser() user: RequestUser,
  ) {
    return this.annotationService.updateAnnotation(bookId, annotationId, user, dto);
  }

  @Delete(':annotationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAnnotation(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('annotationId', ParseIntPipe) annotationId: number,
    @CurrentUser() user: RequestUser,
  ) {
    await this.annotationService.deleteAnnotation(bookId, annotationId, user);
  }
}
