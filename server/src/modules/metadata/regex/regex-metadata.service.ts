import { BadRequestException, Injectable, OnModuleDestroy, ServiceUnavailableException } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  REGEX_METADATA_GROUPS,
  REGEX_METADATA_LIMITS,
  SERIES_INDEX_MAX_LENGTH,
  SERIES_INDEX_PATTERN,
  type RegexMetadataConfig,
  type RegexMetadataDiagnosticCode,
  type RegexMetadataPreview,
  type RegexMetadataValidation,
} from '@bookorbit/types';
import { prepareRegexMetadataPath } from './regex-metadata-path';
import type { RegexMetadataTask, RegexMetadataWorkerData } from './regex-metadata-engine';

const INTERACTIVE_QUEUE_LIMIT = 32;
const TRANSIENT_CODES: ReadonlySet<RegexMetadataDiagnosticCode> = new Set(['timeout', 'busy', 'worker_failed']);

/** Whether the result failed because of the worker pool rather than the rules. */
export function isTransientRegexFailure(code: RegexMetadataDiagnosticCode): boolean {
  return TRANSIENT_CODES.has(code);
}

interface Task {
  input: RegexMetadataTask;
  resolve: (result: RegexMetadataPreview) => void;
}

interface Slot {
  worker: Worker;
  ready: boolean;
  task?: Task;
  timer?: ReturnType<typeof setTimeout>;
  discarding?: boolean;
}

@Injectable()
export class RegexMetadataService implements OnModuleDestroy {
  private readonly slots = new Set<Slot>();
  private readonly queue: Task[] = [];
  private stopped = false;

  /** Rejects rules that cannot be saved; a pool failure is reported as unavailable, never as invalid rules. */
  async validate(config: RegexMetadataConfig | null | undefined): Promise<void> {
    if (config == null) return;
    const { diagnostics } = await this.runWithRetry({ config });
    if (diagnostics.some((diagnostic) => isTransientRegexFailure(diagnostic.code)))
      throw new ServiceUnavailableException('Regex metadata rules could not be checked right now');
    if (diagnostics.length) throw new BadRequestException({ message: 'Invalid regex metadata configuration', diagnostics });
  }

  async check(config: RegexMetadataConfig): Promise<RegexMetadataValidation> {
    const result = await this.run({ config }, true);
    return { valid: result.diagnostics.length === 0, diagnostics: result.diagnostics };
  }

  preview(config: RegexMetadataConfig, relativePath: string): Promise<RegexMetadataPreview> {
    return this.run({ config, inputPath: prepareRegexMetadataPath(relativePath) }, true);
  }

  /** Scanner entry point: never refused for a full queue, and retried once after a pool failure. */
  evaluate(config: RegexMetadataConfig, relativePath: string): Promise<RegexMetadataPreview> {
    return this.runWithRetry({ config, inputPath: prepareRegexMetadataPath(relativePath) });
  }

  private async runWithRetry(input: RegexMetadataTask): Promise<RegexMetadataPreview> {
    const result = await this.run(input, false);
    // The timeout runs on the main thread, so a stalled event loop can trip it; a second attempt tells that apart from a slow expression.
    return result.diagnostics.some((diagnostic) => isTransientRegexFailure(diagnostic.code)) ? this.run(input, false) : result;
  }

  private run(input: RegexMetadataTask, interactive: boolean): Promise<RegexMetadataPreview> {
    this.assertBounds(input.config);
    if (this.stopped) return Promise.resolve(this.failure(input, 'worker_failed'));
    if (interactive && this.queue.length >= INTERACTIVE_QUEUE_LIMIT) return Promise.resolve(this.failure(input, 'busy'));
    return new Promise((resolve) => {
      this.queue.push({ input, resolve });
      this.dispatch();
    });
  }

  private assertBounds(config: RegexMetadataConfig): void {
    if (
      !Array.isArray(config.rules) ||
      !config.rules.length ||
      config.rules.length > REGEX_METADATA_LIMITS.rules ||
      config.rules.some(
        (rule) =>
          !rule ||
          typeof rule.pattern !== 'string' ||
          !rule.pattern.length ||
          rule.pattern.length > REGEX_METADATA_LIMITS.patternLength ||
          typeof rule.flags !== 'string' ||
          !/^(?:i?u?|ui)$/.test(rule.flags),
      )
    ) {
      throw new BadRequestException('Invalid regex metadata rules or flags');
    }
  }

  private dispatch(): void {
    if (this.stopped) return;
    for (const slot of this.slots) {
      if (!slot.ready || slot.discarding || slot.task || !this.queue.length) continue;
      slot.task = this.queue.shift()!;
      slot.timer = setTimeout(() => this.discard(slot, 'timeout'), 100);
      slot.worker.postMessage(slot.task.input);
    }
    if (this.queue.length && this.slots.size < 2) this.spawn();
  }

  private spawn(): void {
    const jsPath = join(__dirname, 'regex-metadata.worker.js');
    const workerPath = existsSync(jsPath) ? jsPath : join(__dirname, 'regex-metadata.worker.ts');
    const workerData: RegexMetadataWorkerData = {
      groups: REGEX_METADATA_GROUPS,
      seriesIndexPattern: SERIES_INDEX_PATTERN,
      seriesIndexMaxLength: SERIES_INDEX_MAX_LENGTH,
    };
    const worker = new Worker(workerPath, {
      workerData,
      execArgv: workerPath.endsWith('.ts') ? ['--import', 'tsx'] : [],
      resourceLimits: { maxOldGenerationSizeMb: 64 },
    });
    const slot: Slot = { worker, ready: false };
    this.slots.add(slot);
    slot.timer = setTimeout(() => this.discard(slot, 'worker_failed'), 10_000);
    worker.on('message', (message: RegexMetadataPreview | 'ready') => {
      if (!this.slots.has(slot) || slot.discarding) return;
      clearTimeout(slot.timer);
      if (message === 'ready') slot.ready = true;
      else {
        slot.task?.resolve(message);
        slot.task = undefined;
      }
      this.dispatch();
    });
    worker.on('error', () => this.discard(slot, 'worker_failed'));
    worker.on('exit', () => this.discard(slot, 'worker_failed'));
  }

  private discard(slot: Slot, code: RegexMetadataDiagnosticCode): void {
    if (!this.slots.has(slot) || slot.discarding) return;
    slot.discarding = true;
    clearTimeout(slot.timer);
    if (slot.task) slot.task.resolve(this.failure(slot.task.input, code));
    else if (!slot.ready) {
      // A broken worker entrypoint must not create an endless respawn loop.
      for (const task of this.queue.splice(0)) task.resolve(this.failure(task.input, code));
    }
    slot.task = undefined;
    void slot.worker.terminate().finally(() => {
      this.slots.delete(slot);
      this.dispatch();
    });
  }

  private failure(input: RegexMetadataTask, code: RegexMetadataDiagnosticCode): RegexMetadataPreview {
    return { inputPath: input.inputPath ?? '', matched: false, ruleIndex: null, groups: {}, metadata: {}, diagnostics: [{ code }] };
  }

  async onModuleDestroy(): Promise<void> {
    this.stopped = true;
    for (const task of this.queue.splice(0)) task.resolve(this.failure(task.input, 'worker_failed'));
    const slots = [...this.slots];
    this.slots.clear();
    await Promise.all(
      slots.map((slot) => {
        clearTimeout(slot.timer);
        if (slot.task) slot.task.resolve(this.failure(slot.task.input, 'worker_failed'));
        return slot.worker.terminate();
      }),
    );
  }
}
