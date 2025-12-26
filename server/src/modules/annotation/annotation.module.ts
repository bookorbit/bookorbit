import { Module } from '@nestjs/common';

import { AnnotationController } from './annotation.controller';
import { AnnotationRepository } from './annotation.repository';
import { AnnotationService } from './annotation.service';

@Module({
  controllers: [AnnotationController],
  providers: [AnnotationService, AnnotationRepository],
})
export class AnnotationModule {}
