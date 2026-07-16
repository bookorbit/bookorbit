import 'reflect-metadata';

import { MODULE_METADATA } from '@nestjs/common/constants';
import { ReadingInsightsSharingController } from './reading-insights-sharing.controller';
import { SharedReadingInsightsController } from './shared-reading-insights.controller';
import { SharedReadingInsightsModule } from './shared-reading-insights.module';
import { SharedReadingInsightsRepository } from './shared-reading-insights.repository';
import { SharedReadingInsightsService } from './shared-reading-insights.service';

describe('SharedReadingInsightsModule', () => {
  it('registers user and administrator controllers with cohesive providers', () => {
    expect(Reflect.getMetadata(MODULE_METADATA.CONTROLLERS, SharedReadingInsightsModule)).toEqual([
      ReadingInsightsSharingController,
      SharedReadingInsightsController,
    ]);
    expect(Reflect.getMetadata(MODULE_METADATA.PROVIDERS, SharedReadingInsightsModule)).toEqual([
      SharedReadingInsightsService,
      SharedReadingInsightsRepository,
    ]);
  });
});
