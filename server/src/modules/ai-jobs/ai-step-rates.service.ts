import { Injectable } from '@nestjs/common';
import type { AiEffort, AiJobSlotModel } from '@bookorbit/types';

import type { AiStepTimingRow, NewAiStepTimingRow } from '../../db/schema';
import { AiStepTimingRepository, type AiStepTimingKey } from './ai-step-timing.repository';

/** A feature's rates are read again after this long, so builds finished on another server count too. */
export const AI_STEP_RATES_TTL_MS = 30_000;

/** What one step managed on one connection and model at one effort. */
export interface AiStepRate {
  step: string;
  connectionId: number;
  model: string;
  /** Null for runs that left effort to the feature. */
  effort: AiEffort | null;
  /** Milliseconds one unit took in one lane: the median of the kept runs. */
  msPerUnit: number;
  /** Runs it was learned from. */
  runs: number;
  /** When the newest of them finished. */
  learnedAt: Date;
}

/** Effort changes how long a model thinks, so each level learns its own speed. */
function keyOf(step: string, connectionId: number, model: string, effort: AiEffort | null | undefined): string {
  return JSON.stringify([step, connectionId, model, effort ?? null]);
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/** A feature's learned rates at one moment. */
export class AiStepRateTable {
  private readonly byKey = new Map<string, AiStepRate>();

  constructor(rows: readonly AiStepTimingRow[]) {
    const groups = new Map<string, AiStepTimingRow[]>();
    for (const row of rows) {
      const key = keyOf(row.step, row.connectionId, row.model, row.effort);
      const group = groups.get(key);
      if (group) group.push(row);
      else groups.set(key, [row]);
    }
    for (const [key, group] of groups) {
      const first = group[0]!;
      this.byKey.set(key, {
        step: first.step,
        connectionId: first.connectionId,
        model: first.model,
        effort: first.effort ?? null,
        // A unit's time in one lane, so a run of a few units teaches the same speed as a run of many.
        msPerUnit: median(group.map((row) => (row.durationMs * row.lanes) / row.units)),
        runs: group.length,
        learnedAt: new Date(Math.max(...group.map((row) => row.createdAt.getTime()))),
      });
    }
  }

  /** Milliseconds a unit of the step takes in one lane on this model and effort, or null before a finished build used them. */
  msPerUnit(step: string, use: AiJobSlotModel | null | undefined): number | null {
    if (!use) return null;
    return this.byKey.get(keyOf(step, use.connectionId, use.model, use.effort))?.msPerUnit ?? null;
  }

  list(): AiStepRate[] {
    return [...this.byKey.values()];
  }
}

/**
 * How fast each model has been, learned from the steps of completed jobs. Estimates are read on
 * every status poll, so a feature's table is cached briefly and dropped when this server learns or
 * forgets something.
 */
@Injectable()
export class AiStepRates {
  private readonly cache = new Map<string, { at: number; table: Promise<AiStepRateTable> }>();

  constructor(private readonly timings: AiStepTimingRepository) {}

  table(feature: string): Promise<AiStepRateTable> {
    const now = Date.now();
    const cached = this.cache.get(feature);
    if (cached && now - cached.at < AI_STEP_RATES_TTL_MS) return cached.table;
    const table = this.timings.forFeature(feature).then((rows) => new AiStepRateTable(rows));
    this.cache.set(feature, { at: now, table });
    // A failed read is not cached: the next caller reads again.
    void table.catch(() => {
      if (this.cache.get(feature)?.table === table) this.cache.delete(feature);
    });
    return table;
  }

  async learn(rows: readonly NewAiStepTimingRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.timings.record(rows);
    for (const feature of new Set(rows.map((row) => row.feature))) this.cache.delete(feature);
  }

  async forget(key: AiStepTimingKey): Promise<number> {
    const removed = await this.timings.remove(key);
    this.cache.delete(key.feature);
    return removed;
  }
}
