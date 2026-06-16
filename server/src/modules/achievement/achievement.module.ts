import { Module } from '@nestjs/common';

import { AppSettingsModule } from '../app-settings/app-settings.module';
import { NotificationModule } from '../notification/notification.module';
import { AchievementController } from './achievement.controller';
import { AchievementService } from './achievement.service';
import { AchievementBackfillService } from './achievement-backfill.service';
import { AchievementRepository } from './achievement.repository';
import { AchievementEventsService } from './achievement-events.service';
import { EvaluatorRegistry } from './evaluators/evaluator-registry';
import { ReadingEvaluator } from './evaluators/reading.evaluator';
import { LibraryEvaluator } from './evaluators/library.evaluator';
import { ExplorationEvaluator } from './evaluators/exploration.evaluator';
import { DedicationEvaluator } from './evaluators/dedication.evaluator';
import { MilestonesEvaluator } from './evaluators/milestones.evaluator';
import { RatingEvaluator } from './evaluators/rating.evaluator';
import { DevicesEvaluator } from './evaluators/devices.evaluator';

@Module({
  imports: [NotificationModule, AppSettingsModule],
  controllers: [AchievementController],
  providers: [
    AchievementService,
    AchievementBackfillService,
    AchievementRepository,
    AchievementEventsService,
    EvaluatorRegistry,
    ReadingEvaluator,
    LibraryEvaluator,
    ExplorationEvaluator,
    DedicationEvaluator,
    MilestonesEvaluator,
    RatingEvaluator,
    DevicesEvaluator,
  ],
  exports: [AchievementEventsService],
})
export class AchievementModule {
  constructor(
    private readonly registry: EvaluatorRegistry,
    private readonly reading: ReadingEvaluator,
    private readonly library: LibraryEvaluator,
    private readonly exploration: ExplorationEvaluator,
    private readonly dedication: DedicationEvaluator,
    private readonly milestones: MilestonesEvaluator,
    private readonly rating: RatingEvaluator,
    private readonly devices: DevicesEvaluator,
  ) {
    this.registry.register(this.reading);
    this.registry.register(this.library);
    this.registry.register(this.exploration);
    this.registry.register(this.dedication);
    this.registry.register(this.milestones);
    this.registry.register(this.rating);
    this.registry.register(this.devices);
  }
}
