import { Injectable, NotFoundException } from '@nestjs/common';
import {
  STORY_GUIDE_FEATURE,
  STORY_GUIDE_TIMED_STEPS,
  type AiJobEstimate,
  type AiJobModels,
  type StoryGuideModelSpeed,
  type StoryGuideSpeedResetRequest,
  type StoryGuideSpeedResetResponse,
  type StoryGuideSpeeds,
  type StoryGuideTimedStep,
} from '@bookorbit/types';

import { AiConnectionService } from '../ai/ai-connection.service';
import { AiSettingsService } from '../ai/ai-settings.service';
import { AiStepRates } from '../ai-jobs/ai-step-rates.service';
import { estimateStoryGuide, STORY_GUIDE_STEP_COSTS, storyGuideMinutesLeft, type StoryGuideStepRates } from './story-guide-estimate';

type Sections = { sections: readonly { words: number }[]; language?: string | null };

export interface StoryGuideRunProgress {
  /** Every step of the pipeline, in order. */
  order: readonly string[];
  phase: string | null;
  done: number;
  total: number;
}

const TIMED_STEPS = new Set<string>(STORY_GUIDE_TIMED_STEPS);

function isTimedStep(step: string): step is StoryGuideTimedStep {
  return TIMED_STEPS.has(step);
}

/** The estimate for a book's text: its sections, the slots' prices, and how fast each model has been. */
@Injectable()
export class StoryGuideEstimator {
  constructor(
    private readonly settings: AiSettingsService,
    private readonly connections: AiConnectionService,
    private readonly rates: AiStepRates,
  ) {}

  /** `models` are the connections and models the steps would use. */
  async estimate(text: Sections, steps: readonly string[], models: AiJobModels): Promise<AiJobEstimate> {
    const [slots, rates] = await Promise.all([this.settings.slots(), this.ratesFor(steps, models)]);
    return estimateStoryGuide({
      sections: text.sections,
      language: text.language,
      steps,
      prices: { fast: slots.fast.prices, careful: slots.careful.prices },
      rates,
    });
  }

  /** Minutes a running build has left on its own models, or null while one of them has no learned speed. */
  async minutesLeft(text: Sections, steps: readonly string[], models: AiJobModels, progress: StoryGuideRunProgress): Promise<number | null> {
    return storyGuideMinutesLeft({
      sections: text.sections,
      language: text.language,
      order: progress.order,
      steps,
      rates: await this.ratesFor(progress.order, models),
      phase: progress.phase,
      done: progress.done,
      total: progress.total,
    });
  }

  private async ratesFor(steps: readonly string[], models: AiJobModels): Promise<StoryGuideStepRates> {
    const table = await this.rates.table(STORY_GUIDE_FEATURE);
    const rates: StoryGuideStepRates = {};
    for (const step of steps) {
      const shape = STORY_GUIDE_STEP_COSTS[step];
      if (shape) rates[step] = table.msPerUnit(step, models[shape.slot]);
    }
    return rates;
  }

  /** What each model has managed at each effort, newest first, for the AI settings page. */
  async speeds(): Promise<StoryGuideSpeeds> {
    const table = await this.rates.table(STORY_GUIDE_FEATURE);
    const byModel = new Map<string, StoryGuideModelSpeed>();
    for (const rate of table.list()) {
      if (!isTimedStep(rate.step)) continue;
      const key = JSON.stringify([rate.connectionId, rate.model, rate.effort]);
      let entry = byModel.get(key);
      if (!entry) {
        entry = {
          connectionId: rate.connectionId,
          connectionName: null,
          model: rate.model,
          ...(rate.effort ? { effort: rate.effort } : {}),
          learnedAt: rate.learnedAt.toISOString(),
          steps: [],
        };
        byModel.set(key, entry);
      }
      if (rate.learnedAt.toISOString() > entry.learnedAt) entry.learnedAt = rate.learnedAt.toISOString();
      entry.steps.push({ step: rate.step, secondsPerCall: Math.round(rate.msPerUnit / 100) / 10, builds: rate.runs });
    }
    const models = [...byModel.values()];
    const names = await this.connectionNames(new Set(models.map((entry) => entry.connectionId)));
    const order = STORY_GUIDE_TIMED_STEPS as readonly string[];
    for (const entry of models) {
      entry.connectionName = names.get(entry.connectionId) ?? null;
      entry.steps.sort((a, b) => order.indexOf(a.step) - order.indexOf(b.step));
    }
    models.sort((a, b) => b.learnedAt.localeCompare(a.learnedAt) || a.model.localeCompare(b.model));
    return { models };
  }

  async resetSpeed(request: StoryGuideSpeedResetRequest): Promise<StoryGuideSpeedResetResponse> {
    const { connectionId, model, effort } = request;
    const removed = await this.rates.forget({
      feature: STORY_GUIDE_FEATURE,
      connectionId,
      model,
      ...(effort === undefined ? {} : { effort: effort === 'auto' ? null : effort }),
    });
    return { removed };
  }

  private async connectionNames(ids: ReadonlySet<number>): Promise<Map<number, string>> {
    const names = new Map<number, string>();
    await Promise.all(
      [...ids].map(async (id) => {
        try {
          names.set(id, (await this.connections.getRow(id)).name);
        } catch (error) {
          if (!(error instanceof NotFoundException)) throw error;
        }
      }),
    );
    return names;
  }
}
