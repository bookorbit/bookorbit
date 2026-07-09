import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  ACHIEVEMENT_EVENT_ANNOTATION_CREATED,
  AchievementEventsService,
  type AnnotationCreatedPayload,
} from '../achievement/achievement-events.service';
import { ReadwiseAutoSyncSchedulerService } from './readwise-auto-sync-scheduler.service';

@Injectable()
export class ReadwiseEventListener implements OnModuleInit {
  constructor(
    private readonly achievementEvents: AchievementEventsService,
    private readonly scheduler: ReadwiseAutoSyncSchedulerService,
  ) {}

  onModuleInit(): void {
    this.achievementEvents.on(ACHIEVEMENT_EVENT_ANNOTATION_CREATED, (payload: AnnotationCreatedPayload) => {
      this.scheduler.requestSync(payload.userId);
    });
  }
}
