import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Post } from '@nestjs/common';

import { AnnotationService } from './annotation.service';
import { CreateAnnotationDto } from './dto/create-annotation.dto';
import { UpdateAnnotationDto } from './dto/update-annotation.dto';

@Controller('books/:bookId/annotations')
export class AnnotationController {
  constructor(private readonly annotationService: AnnotationService) {}

  @Get()
  getAnnotations(@Param('bookId', ParseIntPipe) bookId: number) {
    return this.annotationService.getAnnotations(bookId);
  }

  @Post()
  createAnnotation(@Param('bookId', ParseIntPipe) bookId: number, @Body() dto: CreateAnnotationDto) {
    // TODO: replace with real userId from auth guard once auth is wired up
    return this.annotationService.createAnnotation(1, bookId, dto);
  }

  @Patch(':annotationId')
  updateAnnotation(
    @Param('bookId', ParseIntPipe) bookId: number,
    @Param('annotationId', ParseIntPipe) annotationId: number,
    @Body() dto: UpdateAnnotationDto,
  ) {
    return this.annotationService.updateAnnotation(bookId, annotationId, dto);
  }

  @Delete(':annotationId')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteAnnotation(@Param('bookId', ParseIntPipe) bookId: number, @Param('annotationId', ParseIntPipe) annotationId: number) {
    await this.annotationService.deleteAnnotation(bookId, annotationId);
  }
}
