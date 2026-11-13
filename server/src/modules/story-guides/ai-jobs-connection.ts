import { Injectable, Logger, OnModuleInit, type Provider } from '@nestjs/common';
import type { AiFailureCode, AiFeatureId, AiJobSlotModel, AiSlot } from '@bookorbit/types';

import { AiBudgetService } from '../ai/ai-budget.service';
import { AiClient } from '../ai/ai-client.service';
import type { AiRequest as AiClientRequest, AiSlotChoice } from '../ai/ai-client.types';
import { AiConnectionTestService } from '../ai/ai-connection-test.service';
import { AiConnectionService } from '../ai/ai-connection.service';
import { AI_EVENTS, AiEventsService } from '../ai/ai-events.service';
import { AiJobsBridge } from '../ai/ai-jobs-bridge.service';
import { AiSettingsService } from '../ai/ai-settings.service';
import { AiJobLifecycle } from '../ai-jobs/ai-job-lifecycle.service';
import { AiJobsService } from '../ai-jobs/ai-jobs.service';
import { AI_JOBS_PORTS, type AiHealthReason, type AiJobsPorts, type AiSlot as AiJobSlot } from '../ai-jobs/ai-jobs.ports';

/** A connection's failure as the reason a job pauses. */
export function healthReason(code: AiFailureCode | string | null): AiHealthReason {
  switch (code) {
    case 'key-rejected':
    case 'key-unreadable':
    case 'out-of-credit':
    case 'spend-limit':
    case 'unsupported-api-type':
      return 'provider-auth';
    case 'model-missing':
    case 'no-model':
      return 'model-missing';
    default:
      return 'provider-down';
  }
}

interface ConnectionsView {
  get(id: number): Promise<{ status: string; failingCode: AiFailureCode | null }>;
}

/**
 * The jobs engine's ports, bound to the AI connection: requests go through `AiClient` on the
 * connection and model the job recorded, slots resolve from the settings, health reads the
 * connections' last known state (and tests them on Try again), and budgets reserve through
 * `AiBudgetService`.
 */
export function createAiJobsPorts(deps: {
  client: AiClient;
  budget: AiBudgetService;
  settings: AiSettingsService;
  connections: ConnectionsView;
  tests: Pick<AiConnectionTestService, 'testSaved'>;
}): AiJobsPorts {
  const { client, budget, settings, connections, tests } = deps;

  /** The job's recorded choice, with the slot's current terms while it still names the same model. */
  async function choiceFor(slot: AiSlot, use: AiJobSlotModel | undefined): Promise<AiSlotChoice | undefined> {
    if (!use) return undefined;
    // The effort stays what the job recorded, so a level changed mid-build does not move it either.
    const current = await client.resolveSlot(slot).catch(() => null);
    if (current && current.connectionId === use.connectionId && current.model === use.model) return { ...current, effort: use.effort };
    return { slot, connectionId: use.connectionId, model: use.model, prices: null, jsonMode: 'auto', effort: use.effort };
  }

  async function health(models: Parameters<AiJobsPorts['health']['check']>[1], retest: boolean): Promise<AiHealthReason | null> {
    for (const choice of Object.values(models)) {
      if (!choice) continue;
      if (retest) {
        const result = await tests.testSaved(choice.connectionId, choice.model).catch(() => null);
        if (!result) return 'slot-empty';
        if (!result.ok) return healthReason(result.steps.find((step) => step.ok === false)?.code ?? null);
        continue;
      }
      const connection = await connections.get(choice.connectionId).catch(() => null);
      if (!connection) return 'slot-empty';
      if (connection.status === 'failing') return healthReason(connection.failingCode);
    }
    return null;
  }

  return {
    client: {
      async complete(request) {
        const use = await choiceFor(request.slot, request.use);
        return await client.complete({ ...request, use } as AiClientRequest);
      },
    },
    slots: {
      async resolve(_feature, slots) {
        const models: Awaited<ReturnType<AiJobsPorts['slots']['resolve']>>['models'] = {};
        const missing: AiJobSlot[] = [];
        for (const slot of slots) {
          const choice = await client.resolveSlot(slot).catch(() => null);
          if (choice) models[slot] = { connectionId: choice.connectionId, model: choice.model, ...(choice.effort ? { effort: choice.effort } : {}) };
          else missing.push(slot);
        }
        return { models, missing };
      },
    },
    health: {
      check: (_feature, models) => health(models, false),
      retest: (_feature, models) => health(models, true),
    },
    budget: {
      reserve: (input) => budget.reserve(input),
      release: (jobId) => budget.release(jobId),
    },
    settings: {
      async get(feature) {
        const features = await settings.features();
        const own = features[feature as AiFeatureId];
        return { enabled: own?.enabled ?? false, buildsAtOnce: own?.limits?.concurrentBuilds ?? 1 };
      },
    },
  };
}

export const AI_JOBS_PORTS_PROVIDER: Provider = {
  provide: AI_JOBS_PORTS,
  useFactory: (
    client: AiClient,
    budget: AiBudgetService,
    settings: AiSettingsService,
    connections: AiConnectionService,
    tests: AiConnectionTestService,
  ): AiJobsPorts => createAiJobsPorts({ client, budget, settings, connections, tests }),
  inject: [AiClient, AiBudgetService, AiSettingsService, AiConnectionService, AiConnectionTestService],
};

/**
 * The AI connection's side of the engine: what it asks about jobs, and resuming paused jobs as
 * soon as a connection, slot, budget or feature switch changes.
 */
@Injectable()
export class AiJobsConnection implements OnModuleInit {
  private readonly logger = new Logger(AiJobsConnection.name);

  constructor(
    private readonly bridge: AiJobsBridge,
    private readonly events: AiEventsService,
    private readonly jobs: AiJobsService,
    private readonly lifecycle: AiJobLifecycle,
  ) {}

  onModuleInit(): void {
    this.bridge.register({
      countUnfinishedJobsUsing: (connectionId) => this.jobs.countUnfinishedUsing(connectionId),
      liveJobIds: async (jobIds) => new Set(await this.jobs.unfinishedJobIds(jobIds)),
    });
    const resume = (): void => {
      this.lifecycle.resumePaused().catch((error: unknown) => {
        this.logger.warn(`[ai_jobs.resume] [fail] errorClass=${(error as Error)?.name ?? 'Error'} - resuming paused jobs failed`);
      });
    };
    for (const event of [
      AI_EVENTS.CONNECTION_HEALTHY,
      AI_EVENTS.SLOT_HEALTHY,
      AI_EVENTS.SLOTS_CHANGED,
      AI_EVENTS.BUDGET_CHANGED,
      AI_EVENTS.FEATURE_CHANGED,
    ]) {
      this.events.on(event, resume);
    }
  }
}
