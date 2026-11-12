import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AI_TRY_USAGE_FEATURE, type AiJsonSupport, type AiSlot, type AiTryFailure, type AiTryResult } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { toMicros } from './ai-budget.service';
import { AiClient } from './ai-client.service';
import { isAiError, type AiRequest, type AiResult, type AiSlotChoice } from './ai-client.types';
import { AiConnectionRepository } from './ai-connection.repository';
import { AiSettingsService } from './ai-settings.service';
import { AI_TRY_KINDS, AI_TRY_MAX_OUTPUT_TOKENS, AI_TRY_PASSAGE, AI_TRY_SCHEMA, AI_TRY_SYSTEM } from './ai-try-sample';
import { AI_VISION_MAX_OUTPUT_TOKENS, AI_VISION_SCHEMA, AI_VISION_SYSTEM, aiVisionUser, parseVisionBooks } from './ai-vision';
import { AI_VISION_SAMPLE } from './ai-vision-sample';

/**
 * Try it: one real story-guide step, finding the names in the opening of Pride and Prejudice,
 * through a slot as it is set now; on the Vision slot, reading the books in a picture of three covers. Runs while the feature is off, so the admin can judge a model
 * before turning anything on; it counts against the budget like any request.
 */
@Injectable()
export class AiTryService {
  private readonly logger = new Logger(AiTryService.name);

  constructor(
    private readonly client: AiClient,
    private readonly settings: AiSettingsService,
    private readonly connections: AiConnectionRepository,
  ) {}

  async run(slot: AiSlot): Promise<AiTryResult> {
    const snapshot = await this.settings.snapshot();
    let choice: AiSlotChoice;
    try {
      choice = await this.client.resolveSlot(slot, snapshot);
    } catch {
      throw new BadRequestException({ message: `Choose a connection and model for the ${slot} slot first`, errorCode: 'AI_SLOT_EMPTY' });
    }

    const vision = slot === 'vision';
    const sample: Pick<AiRequest, 'system' | 'user' | 'schema' | 'maxOutputTokens' | 'images'> = vision
      ? {
          system: AI_VISION_SYSTEM,
          user: aiVisionUser('shelf'),
          schema: AI_VISION_SCHEMA,
          maxOutputTokens: AI_VISION_MAX_OUTPUT_TOKENS,
          images: [AI_VISION_SAMPLE],
        }
      : { system: AI_TRY_SYSTEM, user: AI_TRY_PASSAGE, schema: AI_TRY_SCHEMA, maxOutputTokens: AI_TRY_MAX_OUTPUT_TOKENS };

    const started = Date.now();
    let result: AiResult;
    try {
      result = await this.client.complete({ feature: AI_TRY_USAGE_FEATURE, slot, ...sample, use: choice }, { ignoreFeatureSwitch: true });
    } catch (err) {
      if (!isAiError(err)) throw err;
      this.logger.warn(`[ai-try] [run] slot=${slot} model=${sanitizeLogValue(choice.model)} code=${err.code} - Try it failed`);
      const meta: AiTryFailure = {
        code: err.code,
        ...(err.details.failure ? { failure: err.details.failure } : {}),
        ...(err.details.providerMessage ? { providerMessage: err.details.providerMessage } : {}),
      };
      throw new BadRequestException({ message: err.message, errorCode: 'AI_TRY_FAILED', errorMeta: meta });
    }

    if (result.finish === 'refused' || result.finish === 'filtered') {
      throw new BadRequestException({
        message: vision ? 'The model refused the sample picture' : 'The model refused the sample passage',
        errorCode: 'AI_TRY_FAILED',
        errorMeta: { code: 'refused' } satisfies AiTryFailure,
      });
    }

    return {
      slot,
      model: result.model,
      names: vision ? [] : namesOf(result.json),
      ...(vision ? { books: parseVisionBooks(result.json).map(({ title, author }) => ({ title, author })) } : {}),
      durationMs: Date.now() - started,
      usage: { input: result.usage.input, output: result.usage.output, ...(result.usage.reasoning ? { reasoning: result.usage.reasoning } : {}) },
      costMicros: result.usage.cost === undefined ? null : toMicros(result.usage.cost),
      jsonSupport: await this.jsonSupport(choice),
    };
  }

  /** How the slot asks for JSON: its own setting, or on automatic what the last test found. */
  private async jsonSupport(choice: AiSlotChoice): Promise<AiJsonSupport> {
    if (choice.jsonMode !== 'auto') return choice.jsonMode;
    return (await this.connections.findById(choice.connectionId))?.lastTest?.jsonSupport ?? 'schema';
  }
}

function namesOf(json: unknown): AiTryResult['names'] {
  const list = (json as { names?: unknown } | undefined)?.names;
  if (!Array.isArray(list)) return [];
  return list
    .filter((entry): entry is { name: string; kind: string; description: string } => typeof entry?.name === 'string')
    .map((entry) => ({
      name: entry.name,
      kind: (AI_TRY_KINDS as readonly string[]).includes(entry.kind) ? entry.kind : 'thing',
      description: typeof entry.description === 'string' ? entry.description : '',
    }));
}
