import { Module, type OnModuleInit } from '@nestjs/common';
import { STORY_GUIDE_FEATURE } from '@bookorbit/types';

import { AiModule } from '../ai/ai.module';
import { AiJobsBridge } from '../ai/ai-jobs-bridge.service';
import { AiFeatureRegistry } from '../ai-jobs/ai-feature.registry';
import { AiJobsModule } from '../ai-jobs/ai-jobs.module';
import { AiJobsService } from '../ai-jobs/ai-jobs.service';
import { AppAttestModule } from '../app-attest/app-attest.module';
import { BookModule } from '../book/book.module';
import { AI_JOBS_PORTS_PROVIDER, AiJobsConnection } from './ai-jobs-connection';
import { StoryGuideFixesController } from './fixes/story-guide-fixes.controller';
import { StoryGuideFixesRepository } from './fixes/story-guide-fixes.repository';
import { StoryGuideFixesService } from './fixes/story-guide-fixes.service';
import { createStoryGuidePipeline } from './pipeline/create-pipeline';
import { STORY_GUIDE_PIPELINE } from './pipeline/story-guide-pipeline';
import { StoryGuideContentController } from './story-guide-content.controller';
import { StoryGuideEstimator } from './story-guide-estimator.service';
import { StoryGuideFeature } from './story-guide.feature';
import { StoryGuidesAdminController } from './story-guides-admin.controller';
import { StoryGuidesController } from './story-guides.controller';
import { StoryGuidesGateway } from './story-guides.gateway';
import { StoryGuidesRepository } from './story-guides.repository';
import { StoryGuidesService } from './story-guides.service';
import { StoryTextRepository } from './story-text.repository';
import { StoryTextService } from './story-text.service';
import { STORY_TEXT_KEY_MOVES, type StoryTextKeyMoves } from './story-text.types';

/**
 * Story guides, and the AI jobs engine bound to the AI connection. The engine is registered here,
 * once, since story guides are its only feature.
 */
@Module({
  imports: [AiModule, AppAttestModule, BookModule, AiJobsModule.register({ imports: [AiModule], ports: AI_JOBS_PORTS_PROVIDER })],
  controllers: [StoryGuidesController, StoryGuidesAdminController, StoryGuideContentController, StoryGuideFixesController],
  providers: [
    AiJobsConnection,
    StoryTextRepository,
    StoryTextService,
    StoryGuidesRepository,
    StoryGuideFixesRepository,
    StoryGuideFixesService,
    StoryGuideEstimator,
    StoryGuideFeature,
    StoryGuidesService,
    StoryGuidesGateway,
    { provide: STORY_GUIDE_PIPELINE, useFactory: (texts: StoryTextService) => createStoryGuidePipeline(texts), inject: [StoryTextService] },
    {
      provide: STORY_TEXT_KEY_MOVES,
      useFactory: (jobs: AiJobsService, fixes: StoryGuideFixesRepository): StoryTextKeyMoves => ({
        move: async (from, to) => {
          const moved = await jobs.moveArtifact(STORY_GUIDE_FEATURE, from, to);
          await fixes.move(from, to);
          return moved;
        },
      }),
      inject: [AiJobsService, StoryGuideFixesRepository],
    },
  ],
  exports: [StoryGuidesService],
})
export class StoryGuidesModule implements OnModuleInit {
  constructor(
    private readonly registry: AiFeatureRegistry,
    private readonly feature: StoryGuideFeature,
    private readonly bridge: AiJobsBridge,
    private readonly service: StoryGuidesService,
  ) {}

  onModuleInit(): void {
    this.registry.register(this.feature);
    this.bridge.register({ jobLabels: (jobIds) => this.service.jobLabels(jobIds) });
  }
}
