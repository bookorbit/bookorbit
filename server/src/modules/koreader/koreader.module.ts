import { Module } from '@nestjs/common';

import { CommonModule } from '../../common/common.module';
import { AchievementModule } from '../achievement/achievement.module';
import { AnnotationModule } from '../annotation/annotation.module';
import { BookModule } from '../book/book.module';
import { OpdsModule } from '../opds/opds.module';
import { PositionConverterModule } from '../position-converter/position-converter.module';
import { UserModule } from '../user/user.module';
import { UserBookStatusModule } from '../user-book-status/user-book-status.module';
import { KoreaderAnnotationExchangeService } from './koreader-annotation-exchange.service';
import { KoreaderAuthGuard } from './koreader-auth.guard';
import { KoreaderCatalogController } from './koreader-catalog.controller';
import { KoreaderCatalogService } from './koreader-catalog.service';
import { KoreaderPackageService } from './koreader-package.service';
import { KoreaderChapterExtractorService } from './koreader-chapter-extractor.service';
import { KoreaderChapterService } from './koreader-chapter.service';
import { KoreaderController } from './koreader.controller';
import { KoreaderPluginAnnotationService } from './koreader-plugin-annotation.service';
import { KoreaderPluginController } from './koreader-plugin.controller';
import { KoreaderPluginRepository } from './koreader-plugin.repository';
import { KoreaderPluginService } from './koreader-plugin.service';
import { KoreaderRepository } from './koreader.repository';
import { KoreaderService } from './koreader.service';
import { KoreaderStatsService } from './koreader-stats.service';

@Module({
  imports: [CommonModule, UserModule, UserBookStatusModule, AchievementModule, AnnotationModule, BookModule, OpdsModule, PositionConverterModule],
  controllers: [KoreaderController, KoreaderPluginController, KoreaderCatalogController],
  providers: [
    KoreaderService,
    KoreaderRepository,
    KoreaderAuthGuard,
    KoreaderCatalogService,
    KoreaderPackageService,
    KoreaderChapterService,
    KoreaderChapterExtractorService,
    KoreaderPluginService,
    KoreaderPluginRepository,
    KoreaderPluginAnnotationService,
    KoreaderAnnotationExchangeService,
    KoreaderStatsService,
  ],
  exports: [KoreaderService, KoreaderRepository],
})
export class KoreaderModule {}
