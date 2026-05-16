import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { AchievementModule } from '../achievement/achievement.module';
import { AnnotationController } from './annotation.controller';
import { AnnotationRepository } from './annotation.repository';
import { AnnotationService } from './annotation.service';

@Module({
  imports: [BookModule, AchievementModule],
  controllers: [AnnotationController],
  providers: [AnnotationService, AnnotationRepository],
})
export class AnnotationModule {}
