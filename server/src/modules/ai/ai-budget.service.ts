import { Inject, Injectable, Logger } from '@nestjs/common';
import { CronExpression } from '@nestjs/schedule';
import { AI_FEATURE_DEFINITIONS, AI_SLOTS, type AiBudgetState, type AiFeatureDefinition, type AiFeatureId, type AiSlot } from '@bookorbit/types';

import { SystemCron } from '../../common/decorators/system-cron.decorator';
import { sanitizeLogValue } from '../../common/utils/log-sanitize.utils';
import { AiError } from './ai-client.types';
import { AiBudgetRepository, type AiBudgetStore, type AiReservation } from './ai-budget.repository';
import { AI_EVENTS, AiEventsService } from './ai-events.service';
import { AiJobsBridge } from './ai-jobs-bridge.service';
import { aiMonthKey } from './ai-month';
import { AiSettingsService, isAiFeature, type AiSettingsSnapshot } from './ai-settings.service';

/** A build pauses `over-estimate` once it has spent this many times its estimate. */
export const AI_OVER_ESTIMATE_FACTOR = 3;
/** The overview warns from this share of the monthly budget. */
export const AI_BUDGET_WARNING_SHARE = 0.8;

export type AiReserveResult = { ok: true } | { ok: false; reason: 'budget' };

export interface AiReserveRequest {
  jobId: string;
  feature: string;
  /** The build's estimated dollars, or null when a slot it uses has no prices. */
  amount: number | null;
}

export interface AiRequestCost {
  feature: string;
  jobId?: string;
  /** What the request costs at most, or null when its slot has no prices. */
  worstCaseMicros: number | null;
}

/** The limits one scope (the whole server, or one feature) has this month. */
interface Scope {
  label: string;
  feature?: string;
  budgetMicros: number | null;
  buildsPerMonth: number | null;
}

export function toMicros(dollars: number): number {
  return Math.round(dollars * 1_000_000);
}

/**
 * The monthly budget in dollars, server-wide and per feature, counted in the server's time zone.
 *
 * - A request is checked before it is sent, at its worst-case cost, against what is left: the
 *   budget minus this month's spending minus what other running builds still hold in reservations.
 * - A build reserves its estimate when it starts. One that does not fit is refused, so it waits
 *   paused instead of starting and stopping halfway. Its own requests then spend from its own
 *   reservation, which other builds cannot take.
 * - Without prices nothing can be counted in dollars; builds per month, counted when a build
 *   reserves, is the limit then.
 */
@Injectable()
export class AiBudgetService {
  private readonly logger = new Logger(AiBudgetService.name);

  constructor(
    @Inject(AiBudgetRepository) private readonly store: AiBudgetStore,
    private readonly settings: AiSettingsService,
    private readonly bridge: AiJobsBridge,
    private readonly events: AiEventsService,
  ) {}

  /** Throws `AiError('budget')` when the request does not fit in what is left this month. */
  async checkRequest(request: AiRequestCost): Promise<void> {
    const snapshot = await this.settings.snapshot();
    const scopes = this.scopes(snapshot, request.feature).filter((scope) => scope.budgetMicros !== null);
    if (scopes.length === 0) return;

    const month = aiMonthKey(new Date());
    const others = (await this.liveReservations(this.store)).filter((reservation) => reservation.jobId !== request.jobId);
    const held = await this.outstanding(this.store, others);

    for (const scope of scopes) {
      const budget = scope.budgetMicros as number;
      const spent = await this.store.spentMicros(month, scope.feature);
      const heldByOthers = sumHeld(held, scope.feature);
      const fits = request.worstCaseMicros === null ? spent < budget : spent + heldByOthers + request.worstCaseMicros <= budget;
      if (!fits) {
        throw new AiError('budget', scope.feature ? "This feature's monthly AI budget is used up" : 'The monthly AI budget is used up');
      }
    }
  }

  /**
   * Holds a build's estimate for it until `release`. Calling it again for the same job changes the
   * amount (after Continue, or on resume) and does not count a second build.
   */
  async reserve(request: AiReserveRequest): Promise<AiReserveResult> {
    const snapshot = await this.settings.snapshot();
    const month = aiMonthKey(new Date());
    const amountMicros = request.amount === null ? 0 : toMicros(request.amount);

    return this.store.locked(async (store) => {
      const existing = await store.findReservation(request.jobId);
      const others = (await this.liveReservations(store)).filter((reservation) => reservation.jobId !== request.jobId);
      const held = await this.outstanding(store, others);
      const spentByJob = existing ? ((await store.jobSpentMicros([request.jobId])).get(request.jobId) ?? 0) : 0;
      const needed = Math.max(0, amountMicros - spentByJob);

      for (const scope of this.scopes(snapshot, request.feature)) {
        if (!existing && scope.buildsPerMonth !== null && (await store.buildsInMonth(month, scope.feature)) >= scope.buildsPerMonth) {
          this.logRefusal(request, scope, 'builds');
          return { ok: false, reason: 'budget' } as const;
        }
        if (scope.budgetMicros === null) continue;
        const spent = await store.spentMicros(month, scope.feature);
        const fits = request.amount === null ? spent < scope.budgetMicros : spent + sumHeld(held, scope.feature) + needed <= scope.budgetMicros;
        if (!fits) {
          this.logRefusal(request, scope, 'dollars');
          return { ok: false, reason: 'budget' } as const;
        }
      }

      await store.upsertReservation({ jobId: request.jobId, feature: request.feature, month: existing?.month ?? month, amountMicros });
      return { ok: true } as const;
    });
  }

  /** Gives back what the build did not spend. Safe to call more than once. */
  async release(jobId: string): Promise<void> {
    await this.store.release([jobId], new Date());
  }

  /**
   * True once a build has spent three times its estimate, or three times more after each
   * Continue. A model that loops, or a price set wrong, stops here.
   */
  overEstimate(input: { spentMicros: number; estimateMicros: number; continues: number }): boolean {
    if (input.estimateMicros <= 0) return false;
    return input.spentMicros >= input.estimateMicros * AI_OVER_ESTIMATE_FACTOR * (Math.max(0, input.continues) + 1);
  }

  /** What one job has spent in all, in micro-dollars. */
  async jobSpentMicros(jobId: string): Promise<number> {
    return (await this.store.jobSpentMicros([jobId])).get(jobId) ?? 0;
  }

  /** The budget as the overview shows it: the whole server, or one feature. */
  async state(feature?: AiFeatureId, snapshot?: AiSettingsSnapshot): Promise<AiBudgetState> {
    const settings = snapshot ?? (await this.settings.snapshot());
    const month = aiMonthKey(new Date());
    const scope = feature ? this.featureScope(settings, feature) : this.serverScope(settings);
    const live = await this.liveReservations(this.store);
    const held = sumHeld(await this.outstanding(this.store, live), feature);
    const spent = await this.store.spentMicros(month, feature);
    const builds = await this.store.buildsInMonth(month, feature);
    const used = scope.budgetMicros === null ? null : scope.budgetMicros === 0 ? 1 : spent / scope.budgetMicros;
    const buildsUsedUp = scope.buildsPerMonth !== null && builds >= scope.buildsPerMonth;

    return {
      month,
      monthlyBudget: feature ? settings.features[feature].monthlyBudget : settings.budget.monthlyBudget,
      spentMicros: spent,
      reservedMicros: held,
      used,
      warning: used !== null && used >= AI_BUDGET_WARNING_SHARE,
      exhausted: (used !== null && used >= 1) || buildsUsedUp,
      buildsPerMonth: scope.buildsPerMonth,
      buildsThisMonth: builds,
      countsBuilds: this.slotsWithoutPrices(settings, feature).length > 0,
    };
  }

  /** A new month frees the budget: tell paused jobs to look again. */
  @SystemCron(CronExpression.EVERY_1ST_DAY_OF_MONTH_AT_MIDNIGHT)
  monthTurned(): void {
    this.logger.log(`[ai-budget] [month] month=${aiMonthKey(new Date())} - New budget month`);
    this.events.emit(AI_EVENTS.BUDGET_CHANGED);
  }

  /** Slots in use that have no prices, so their spending cannot be counted in dollars. */
  slotsWithoutPrices(settings: AiSettingsSnapshot, feature?: AiFeatureId): AiSlot[] {
    const definition: AiFeatureDefinition | null = feature ? AI_FEATURE_DEFINITIONS[feature] : null;
    const slots = definition ? [...definition.slots, ...(definition.optionalSlots ?? [])] : AI_SLOTS;
    return slots.filter((slot) => {
      const choice = settings.slots[slot];
      return choice.connectionId !== null && choice.model !== null && choice.prices === null;
    });
  }

  private scopes(settings: AiSettingsSnapshot, feature: string): Scope[] {
    const scopes = [this.serverScope(settings)];
    if (isAiFeature(feature)) scopes.push(this.featureScope(settings, feature));
    return scopes;
  }

  private serverScope(settings: AiSettingsSnapshot): Scope {
    const budget = settings.budget;
    return {
      label: 'server',
      budgetMicros: budget.monthlyBudget === null ? null : toMicros(budget.monthlyBudget),
      buildsPerMonth: budget.buildsPerMonth,
    };
  }

  private featureScope(settings: AiSettingsSnapshot, feature: AiFeatureId): Scope {
    const own = settings.features[feature];
    return {
      label: feature,
      feature,
      budgetMicros: own.monthlyBudget === null ? null : toMicros(own.monthlyBudget),
      buildsPerMonth: own.buildsPerMonth,
    };
  }

  /** Unreleased reservations whose job still exists; the rest are released on the way. */
  private async liveReservations(store: AiBudgetStore): Promise<AiReservation[]> {
    const active = await store.activeReservations();
    if (active.length === 0) return active;
    const live = await this.bridge.liveJobIds(active.map((reservation) => reservation.jobId));
    if (live === null) return active;
    const gone = active.filter((reservation) => !live.has(reservation.jobId)).map((reservation) => reservation.jobId);
    if (gone.length > 0) {
      await store.release(gone, new Date());
      this.logger.log(`[ai-budget] [reservations] released=${gone.length} - Dropped reservations of jobs that no longer exist`);
    }
    return active.filter((reservation) => live.has(reservation.jobId));
  }

  /** What each reservation still holds: its amount less what its job has spent. */
  private async outstanding(store: AiBudgetStore, reservations: AiReservation[]): Promise<Array<{ feature: string; micros: number }>> {
    const spent = await store.jobSpentMicros(reservations.map((reservation) => reservation.jobId));
    return reservations.map((reservation) => ({
      feature: reservation.feature,
      micros: Math.max(0, reservation.amountMicros - (spent.get(reservation.jobId) ?? 0)),
    }));
  }

  private logRefusal(request: AiReserveRequest, scope: Scope, limit: 'builds' | 'dollars'): void {
    this.logger.log(
      `[ai-budget] [reserve] job=${sanitizeLogValue(request.jobId)} feature=${sanitizeLogValue(request.feature)} scope=${sanitizeLogValue(scope.label)} limit=${limit} - Build does not fit this month`,
    );
  }
}

function sumHeld(held: Array<{ feature: string; micros: number }>, feature?: string): number {
  return held.filter((entry) => feature === undefined || entry.feature === feature).reduce((total, entry) => total + entry.micros, 0);
}
