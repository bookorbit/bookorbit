import { describe, expect, it } from 'vitest';

import { KoreaderAnnotationExchangeService } from './koreader-annotation-exchange.service';
import { KoreaderAuthGuard } from './koreader-auth.guard';
import { KoreaderCatalogController } from './koreader-catalog.controller';
import { KoreaderCatalogService } from './koreader-catalog.service';
import { KoreaderChapterExtractorService } from './koreader-chapter-extractor.service';
import { KoreaderChapterService } from './koreader-chapter.service';
import { KoreaderController } from './koreader.controller';
import { KoreaderHashLinkService } from './koreader-hash-link.service';
import { KoreaderModule } from './koreader.module';
import { KoreaderPackageService } from './koreader-package.service';
import { KoreaderPluginAnnotationService } from './koreader-plugin-annotation.service';
import { KoreaderPluginController } from './koreader-plugin.controller';
import { KoreaderPluginRepository } from './koreader-plugin.repository';
import { KoreaderPluginService } from './koreader-plugin.service';
import { KoreaderRepository } from './koreader.repository';
import { KoreaderService } from './koreader.service';
import { KoreaderStatsService } from './koreader-stats.service';

describe('KoreaderModule', () => {
  it('registers expected controllers, providers, and exports', () => {
    expect(Reflect.getMetadata('controllers', KoreaderModule)).toEqual([KoreaderController, KoreaderPluginController, KoreaderCatalogController]);
    expect(Reflect.getMetadata('providers', KoreaderModule)).toEqual([
      KoreaderService,
      KoreaderHashLinkService,
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
    ]);
    expect(Reflect.getMetadata('exports', KoreaderModule)).toEqual([KoreaderService, KoreaderRepository]);
  });
});
