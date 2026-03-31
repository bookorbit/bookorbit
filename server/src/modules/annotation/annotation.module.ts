import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { AnnotationController } from './annotation.controller';
import { AnnotationRepository } from './annotation.repository';
import { AnnotationService } from './annotation.service';

@Module({
  imports: [BookModule],
  controllers: [AnnotationController],
  providers: [AnnotationService, AnnotationRepository],
})
export class AnnotationModule {}
