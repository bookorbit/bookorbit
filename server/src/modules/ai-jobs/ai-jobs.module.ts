import { Module, type DynamicModule, type ModuleMetadata, type Provider } from '@nestjs/common';

import { AuditModule } from '../audit/audit.module';
import { JobsModule } from '../jobs/jobs.module';
import { NotificationModule } from '../notification/notification.module';
import { UserModule } from '../user/user.module';
import { AiArtifactRepository } from './ai-artifact.repository';
import { AiFeatureRegistry } from './ai-feature.registry';
import { AiJobActivityService } from './ai-job-activity.service';
import { AiJobChanges } from './ai-job-changes.service';
import { AiJobChecks } from './ai-job-checks.service';
import { AiJobEventRepository } from './ai-job-event.repository';
import { AiJobLifecycle } from './ai-job-lifecycle.service';
import { AiJobNotifier } from './ai-job-notifier.service';
import { AiJobPauses } from './ai-job-pauses.service';
import { AiJobQueueService } from './ai-job-queue.service';
import { AiJobRepository } from './ai-job.repository';
import { AiJobRunner } from './ai-job-runner.service';
import { AiJobStepRepository } from './ai-job-step.repository';
import { AiJobWorker } from './ai-job-worker.service';
import { AiJobsController } from './ai-jobs.controller';
import { AiJobsGateway } from './ai-jobs.gateway';
import { AiJobsService } from './ai-jobs.service';
import { AiStepRates } from './ai-step-rates.service';
import { AiStepTimingRepository } from './ai-step-timing.repository';
import { StoryGuideJobSource } from './story-guide-job-source';
import { AI_JOBS_PORTS, DISCONNECTED_AI_JOBS_PORTS } from './ai-jobs.ports';

const PROVIDERS = [
  AiArtifactRepository,
  AiFeatureRegistry,
  AiJobChanges,
  AiJobActivityService,
  AiJobChecks,
  AiJobEventRepository,
  AiJobLifecycle,
  AiJobNotifier,
  AiJobPauses,
  AiJobQueueService,
  AiJobRepository,
  AiJobRunner,
  AiJobStepRepository,
  AiJobWorker,
  AiJobsGateway,
  AiJobsService,
  AiStepRates,
  AiStepTimingRepository,
  StoryGuideJobSource,
];

export interface AiJobsModuleOptions {
  /** Modules the ports provider needs, such as the AI connection's. */
  imports?: ModuleMetadata['imports'];
  /** Provides `AI_JOBS_PORTS`. Without it every feature reads as switched off. */
  ports?: Provider;
}

/**
 * The generic engine for AI features: jobs, leases, the step cache, events and artifacts. A feature
 * module registers its feature with `AiFeatureRegistry` and calls `AiJobsService`; the AI connection
 * calls `AiJobLifecycle.resumePaused` when a connection, slot, budget or switch changes.
 */
@Module({})
export class AiJobsModule {
  static register(options: AiJobsModuleOptions = {}): DynamicModule {
    return {
      module: AiJobsModule,
      controllers: [AiJobsController],
      imports: [AuditModule, JobsModule, NotificationModule, UserModule, ...(options.imports ?? [])],
      providers: [...PROVIDERS, options.ports ?? { provide: AI_JOBS_PORTS, useValue: DISCONNECTED_AI_JOBS_PORTS }],
      // The lifecycle is exported so the AI connection can resume paused jobs as soon as a cause clears,
      // the change feed so a feature's pages can hear their jobs move, and the learned rates for estimates.
      exports: [AiFeatureRegistry, AiJobChanges, AiJobLifecycle, AiJobsService, AiStepRates],
    };
  }
}
