import { Injectable, Logger } from '@nestjs/common';
import type { AiJobEventLevel } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { AiJobEventRow } from '../../db/schema';
import { AiJobEventRepository } from './ai-job-event.repository';

export type AiJobEventData = Record<string, string | number | boolean | null>;

const CODE_LIMIT = 60;
const DATA_KEYS_LIMIT = 20;
const DATA_TEXT_LIMIT = 300;

/** The per-job progress log managers can open: claims, steps, pauses, failures. */
@Injectable()
export class AiJobActivityService {
  private readonly logger = new Logger(AiJobActivityService.name);

  constructor(private readonly events: AiJobEventRepository) {}

  async record(jobId: string, level: AiJobEventLevel, step: string | null, code: string, data: AiJobEventData | null = null): Promise<void> {
    try {
      await this.events.append([{ jobId, level, step, code: code.slice(0, CODE_LIMIT), data: data ? boundData(data) : null }]);
    } catch (error) {
      // The log is diagnostic; losing an entry must never fail the job it describes.
      this.logger.warn(
        `[ai_jobs.activity] [fail] jobId=${jobId} code=${code} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - activity log write failed`,
      );
    }
  }

  async list(jobId: string, afterId: number | null): Promise<AiJobEventRow[]> {
    return await this.events.list(jobId, afterId);
  }
}

function boundData(data: AiJobEventData): AiJobEventData {
  return Object.fromEntries(
    Object.entries(data)
      .slice(0, DATA_KEYS_LIMIT)
      .map(([key, value]) => [key, typeof value === 'string' ? oneLine(value).slice(0, DATA_TEXT_LIMIT) : value]),
  );
}

/** Control characters become spaces so a value stays on one line wherever it is shown. */
function oneLine(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  }).join('');
}
