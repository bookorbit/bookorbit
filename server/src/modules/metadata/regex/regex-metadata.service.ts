import { BadRequestException, Injectable, OnModuleDestroy } from '@nestjs/common';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import {
  REGEX_METADATA_LIMITS,
  type RegexMetadataConfig,
  type RegexMetadataDiagnosticCode,
  type RegexMetadataPreview,
  type RegexMetadataValidation,
} from '@bookorbit/types';
import { prepareRegexMetadataPath } from './regex-metadata-path';
import type { RegexMetadataTask } from './regex-metadata-engine';

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

  async validate(config: RegexMetadataConfig | null | undefined): Promise<void> {
    if (config == null) return;
    const result = await this.check(config);
    if (result.diagnostics.length)
      throw new BadRequestException({ message: 'Invalid regex metadata configuration', diagnostics: result.diagnostics });
  }

  async check(config: RegexMetadataConfig): Promise<RegexMetadataValidation> {
    const result = await this.run({ config });
    return { valid: result.diagnostics.length === 0, diagnostics: result.diagnostics };
  }

  preview(config: RegexMetadataConfig, relativePath: string): Promise<RegexMetadataPreview> {
    return this.run({ config, inputPath: prepareRegexMetadataPath(relativePath) });
  }

  private run(input: RegexMetadataTask): Promise<RegexMetadataPreview> {
    this.assertBounds(input.config);
    if (this.stopped) return Promise.resolve(this.failure(input, 'worker_failed'));
    if (this.queue.length >= 32) return Promise.resolve(this.failure(input, 'busy'));
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
    const worker = new Worker(workerPath, {
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
