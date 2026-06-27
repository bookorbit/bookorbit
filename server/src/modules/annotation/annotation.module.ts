import { Module } from '@nestjs/common';

import { BookModule } from '../book/book.module';
import { AchievementModule } from '../achievement/achievement.module';
import { PositionConverterModule } from '../position-converter/position-converter.module';
import { AnnotationController } from './annotation.controller';
import { AnnotationExportService } from './annotation-export.service';
import { AnnotationHubController } from './annotation-hub.controller';
import { AnnotationHubService } from './annotation-hub.service';
import { AnnotationConversionService } from './annotation-conversion.service';
import { AnnotationPositionRepository } from './annotation-position.repository';
import { AnnotationRepository } from './annotation.repository';
import { AnnotationService } from './annotation.service';
import { AnnotationSyncRepository } from './annotation-sync.repository';
import { AnnotationSyncService } from './annotation-sync.service';

@Module({
  imports: [BookModule, AchievementModule, PositionConverterModule],
  controllers: [AnnotationController, AnnotationHubController],
  providers: [
    AnnotationService,
    AnnotationRepository,
    AnnotationPositionRepository,
    AnnotationSyncRepository,
    AnnotationSyncService,
    AnnotationConversionService,
    AnnotationExportService,
    AnnotationHubService,
  ],
  exports: [AnnotationSyncService],
})
export class AnnotationModule {}
