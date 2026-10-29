import { Injectable, Logger } from '@nestjs/common';
import type { ReadAloudJobEvent, ReadAloudJobEventLevel, ReadAloudJobStage, ReadAloudWorkerEvent } from '@bookorbit/types';

import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import type { NewReadAloudJobEventRow } from '../../db/schema';
import { ReadAloudEventRepository } from './read-aloud-event.repository';

type EventData = Record<string, string | number | boolean | null>;

const MESSAGE_LIMIT = 500;
const CODE_LIMIT = 60;
const DATA_KEYS_LIMIT = 20;

/** The per-job activity log the Details panel shows: stage timings, retries, warnings, failures. */
@Injectable()
export class ReadAloudActivityService {
  private readonly logger = new Logger(ReadAloudActivityService.name);

  constructor(private readonly events: ReadAloudEventRepository) {}

  async record(
    jobId: string,
    level: ReadAloudJobEventLevel,
    stage: ReadAloudJobStage | null,
    code: string,
    message: string | null = null,
    data: EventData | null = null,
  ): Promise<void> {
    await this.append([this.row(jobId, new Date(), level, stage, code, message, data)]);
  }

  async recordWorkerEvents(jobId: string, events: ReadAloudWorkerEvent[]): Promise<void> {
    if (events.length === 0) return;
    await this.append(events.map((event) => this.row(jobId, new Date(event.at), event.level, event.stage, event.code, event.message, event.data)));
  }

  async list(jobId: string, afterId: number | null): Promise<ReadAloudJobEvent[]> {
    const rows = await this.events.list(jobId, afterId);
    return rows.map((row) => ({
      id: row.id,
      at: row.at.toISOString(),
      level: row.level as ReadAloudJobEventLevel,
      stage: (row.stage as ReadAloudJobStage | null) ?? null,
      code: row.code,
      message: row.message,
      data: row.data ?? null,
    }));
  }

  private async append(rows: NewReadAloudJobEventRow[]): Promise<void> {
    try {
      await this.events.append(rows);
    } catch (error) {
      // The log is diagnostic; losing an entry must never fail the job it describes.
      this.logger.warn(
        `[read_aloud.activity] [fail] jobId=${rows[0]?.jobId ?? 'unknown'} count=${rows.length} errorClass=${error instanceof Error ? error.name : 'Error'} error="${sanitizeLogValue(error instanceof Error ? error.message : String(error))}" - activity log write failed`,
      );
    }
  }

  private row(
    jobId: string,
    at: Date,
    level: ReadAloudJobEventLevel,
    stage: ReadAloudJobStage | null,
    code: string,
    message: string | null,
    data: EventData | null,
  ): NewReadAloudJobEventRow {
    return {
      jobId,
      at: Number.isNaN(at.getTime()) ? new Date() : at,
      level: level === 'warn' || level === 'error' ? level : 'info',
      stage,
      code: code.slice(0, CODE_LIMIT),
      message: message ? displayText(message).slice(0, MESSAGE_LIMIT) || null : null,
      data: data ? Object.fromEntries(Object.entries(data).slice(0, DATA_KEYS_LIMIT)) : null,
    };
  }
}

/** Turns control characters into spaces so a message stays on one line wherever it is shown. */
function displayText(value: string): string {
  return Array.from(value, (character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 ? ' ' : character;
  })
    .join('')
    .trim();
}
