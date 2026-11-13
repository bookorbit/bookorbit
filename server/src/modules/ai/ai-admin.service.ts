import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  AI_FEATURE_DEFINITIONS,
  AI_FEATURES,
  AI_SLOTS,
  AuditAction,
  AuditResource,
  type AiConnection,
  type AiConnectionInUse,
  type AiConnectionTestResult,
  type AiFeatureId,
  type AiFeatureLimits,
  type AiFeatureDefinition,
  type AiFeatureSettings,
  type AiModelList,
  type AiOverview,
  type AiSettings,
  type AiSlot,
  type AiSlotSettings,
  type AiSlotsUpdateResult,
  type AiTryResult,
  type AiUsageReport,
  type AiUsageTotals,
  type CreateAiConnectionRequest,
  type TestAiConnectionRequest,
  type UpdateAiBudgetRequest,
  type UpdateAiConnectionRequest,
  type UpdateAiFeatureRequest,
  type UpdateAiSlotsRequest,
} from '@bookorbit/types';

import { AUDIT_EVENT, AuditEventsService } from '../audit/audit-events.service';
import { AiBudgetService } from './ai-budget.service';
import { AiConnectionTestService } from './ai-connection-test.service';
import { AiConnectionService } from './ai-connection.service';
import { AI_EVENTS, AiEventsService, type AiFeatureChangedEvent } from './ai-events.service';
import { AiJobsBridge } from './ai-jobs-bridge.service';
import { AiLedgerRepository, type AiUsageGroup } from './ai-ledger.repository';
import { aiMonthKey, aiMonthRange, shiftAiMonth } from './ai-month';
import { AiSettingsService, isAiFeature, type AiSettingsSnapshot } from './ai-settings.service';
import { AiTryService } from './ai-try.service';

/** Who made a change, for the audit log. */
export interface AiActor {
  userId: number;
  username: string;
  ip?: string;
}

const DEFAULT_USAGE_MONTHS = 12;
const MAX_USAGE_MONTHS = 36;
const COSTLIEST_JOBS = 10;
const RECENT_ERRORS = 20;

const CSV_COLUMNS = [
  'month',
  'feature',
  'slot',
  'connection',
  'model',
  'requests',
  'errors',
  'input_tokens',
  'output_tokens',
  'reasoning_tokens',
  'cached_tokens',
  'cost_usd',
  'unknown_cost_requests',
] as const;

/**
 * What the admin page calls: connections, slots, features, budget, tests, Try it and usage. Each
 * concern saves on its own, so an older page that lacks a newer field never overwrites it.
 */
@Injectable()
export class AiAdminService {
  constructor(
    private readonly connections: AiConnectionService,
    private readonly tester: AiConnectionTestService,
    private readonly tryService: AiTryService,
    private readonly settings: AiSettingsService,
    private readonly budget: AiBudgetService,
    private readonly ledger: AiLedgerRepository,
    private readonly bridge: AiJobsBridge,
    private readonly events: AiEventsService,
    private readonly audit: AuditEventsService,
  ) {}

  async overview(): Promise<AiOverview> {
    const month = aiMonthKey();
    const [snapshot, connections, groups] = await Promise.all([this.settings.snapshot(), this.connections.list(), this.ledger.groups(month, month)]);
    const totals = sumGroups(groups);
    return {
      encryptionConfigured: this.connections.isEncryptionConfigured(),
      month: {
        month,
        requests: totals.requests,
        errors: totals.errors,
        costMicros: totals.costMicros,
        unknownCostRequests: totals.unknownCostRequests,
      },
      budget: await this.budget.state(undefined, snapshot),
      failingConnections: connections
        .filter((connection) => connection.status === 'failing')
        .map((connection) => ({
          id: connection.id,
          name: connection.name,
          failingSince: connection.failingSince ?? connection.updatedAt,
          code: connection.failingCode,
          reason: connection.failingReason,
        })),
      failingSlots: AI_SLOTS.flatMap((slot) => {
        const health = snapshot.slotHealth[slot];
        return health ? [{ slot, ...health }] : [];
      }),
    };
  }

  listConnections(): Promise<AiConnection[]> {
    return this.connections.list();
  }

  async createConnection(request: CreateAiConnectionRequest): Promise<AiConnection> {
    const row = await this.connections.create(request);
    return this.connections.get(row.id);
  }

  /** Records the fields that changed, never their values, and a key replaced or removed on its own. */
  async updateConnection(id: number, request: UpdateAiConnectionRequest, actor: AiActor): Promise<AiConnection> {
    const { row, changes } = await this.connections.update(id, request);
    if (changes.fields.length > 0) {
      this.emitAudit(actor, AuditAction.AiConnectionUpdate, AuditResource.AiConnection, row.id, `Edited AI connection '${row.name}'`, {
        fields: changes.fields,
      });
    }
    if (changes.key) {
      const replaced = changes.key === 'replaced';
      this.emitAudit(
        actor,
        replaced ? AuditAction.AiConnectionKeyReplace : AuditAction.AiConnectionKeyRemove,
        AuditResource.AiConnection,
        row.id,
        `${replaced ? 'Replaced' : 'Removed'} the key of AI connection '${row.name}'`,
      );
    }
    return this.connections.get(row.id);
  }

  /** Refused while a slot uses the connection, or an unfinished job recorded it. */
  async deleteConnection(id: number): Promise<void> {
    await this.connections.getRow(id);
    const slots = await this.settings.slots();
    const usedBy = AI_SLOTS.filter((slot) => slots[slot].connectionId === id);
    const unfinishedJobs = await this.bridge.countUnfinishedJobsUsing(id);
    if (usedBy.length > 0 || unfinishedJobs > 0) {
      throw new ConflictException({
        message: usedBy.length > 0 ? `This connection is used by the ${usedBy.join(' and ')} slot` : 'Unfinished builds are using this connection',
        errorCode: 'AI_CONNECTION_IN_USE',
        errorMeta: { slots: usedBy.join(','), unfinishedJobs } satisfies AiConnectionInUse,
      });
    }
    await this.connections.remove(id);
  }

  async testDraft(request: TestAiConnectionRequest): Promise<AiConnectionTestResult> {
    const connection = await this.connections.resolveDraft(request);
    const slots = request.connectionId !== undefined ? await this.settings.slots() : null;
    const slotModel = slots ? (AI_SLOTS.map((slot) => slots[slot]).find((slot) => slot.connectionId === request.connectionId)?.model ?? null) : null;
    return this.tester.test(connection, { model: request.model, slotModel });
  }

  testSaved(id: number, model?: string): Promise<AiConnectionTestResult> {
    return this.tester.testSaved(id, model);
  }

  listModels(id: number): Promise<AiModelList> {
    return this.tester.listModels(id);
  }

  async getSettings(snapshot?: AiSettingsSnapshot): Promise<AiSettings> {
    const settings = snapshot ?? (await this.settings.snapshot());
    return {
      slots: settings.slots,
      slotHealth: settings.slotHealth,
      features: AI_FEATURES.map((id) => ({
        id,
        settings: settings.features[id],
        privacy: settings.privacy[id] ?? null,
        missingSlots: AI_FEATURE_DEFINITIONS[id].slots.filter(
          (slot) => settings.slots[slot].connectionId === null || settings.slots[slot].model === null,
        ),
      })),
      budget: settings.budget,
    };
  }

  /**
   * Slots left out stay as they are. A slot whose connection or model changes loses its health
   * entry, and its prices, output limit and effort unless they are sent again. A new effort clears
   * the health entry too, since a refused level is one of the things it records.
   */
  async updateSlots(request: UpdateAiSlotsRequest): Promise<AiSlotsUpdateResult> {
    const current = await this.settings.slots();
    const next = { ...current };
    const changed: AiSlot[] = [];
    const cleared: AiSlot[] = [];

    for (const slot of AI_SLOTS) {
      const patch = request[slot];
      if (!patch) continue;
      const model = patch.model?.trim() || null;
      const connectionId = model === null ? null : patch.connectionId;
      if (connectionId !== null) await this.connections.getRow(connectionId);
      if ((connectionId === null) !== (model === null)) {
        throw new BadRequestException(`Choose both a connection and a model for the ${slot} slot, or neither`);
      }

      const before = current[slot];
      const sameModel = before.connectionId === connectionId && before.model === model;
      const updated: AiSlotSettings = {
        connectionId,
        model,
        prices: patch.prices !== undefined ? patch.prices : sameModel ? before.prices : null,
        jsonMode: patch.jsonMode ?? before.jsonMode,
        maxOutputTokens: patch.maxOutputTokens !== undefined ? patch.maxOutputTokens : sameModel ? before.maxOutputTokens : null,
        effort: patch.effort ?? (sameModel ? before.effort : 'auto'),
      };
      if (JSON.stringify(updated) !== JSON.stringify(before)) changed.push(slot);
      if (!sameModel || updated.effort !== before.effort) cleared.push(slot);
      next[slot] = updated;
    }

    if (changed.length > 0) {
      await this.settings.saveSlots(next);
      for (const slot of cleared) await this.settings.setSlotHealth(slot, null);
      this.events.emit(AI_EVENTS.SLOTS_CHANGED);
    }
    return { ...(await this.getSettings()), changed };
  }

  async updateFeature(feature: string, request: UpdateAiFeatureRequest, actor: AiActor): Promise<AiSettings> {
    if (!isAiFeature(feature)) throw new NotFoundException('Unknown AI feature');
    const snapshot = await this.settings.snapshot();
    const current = snapshot.features[feature];
    const confirmed = snapshot.privacy[feature];

    if (request.enabled === true && !current.enabled && !confirmed && request.confirmPrivacy !== true) {
      throw new BadRequestException({
        message: 'Confirm what is sent to the provider before turning this feature on',
        errorCode: 'AI_PRIVACY_CONFIRMATION_REQUIRED',
      });
    }
    if (request.confirmPrivacy === true && !confirmed) {
      await this.settings.savePrivacy(feature, { userId: actor.userId, username: actor.username, at: new Date().toISOString() });
      this.emitAudit(actor, AuditAction.AiPrivacyConfirm, AuditResource.AiSettings, undefined, `Confirmed what ${feature} sends to the AI provider`, {
        feature,
      });
    }

    const perReader = (AI_FEATURE_DEFINITIONS[feature] as AiFeatureDefinition).perReader === true;
    if (!perReader && (request.readerMonthlyBudget !== undefined || request.readerRequestsPerMonth !== undefined)) {
      throw new BadRequestException('This feature has no per-reader caps');
    }
    const updated: AiFeatureSettings = {
      enabled: request.enabled ?? current.enabled,
      limits: { ...current.limits, ...checkedLimits(feature, request.limits) },
      monthlyBudget: request.monthlyBudget !== undefined ? request.monthlyBudget : current.monthlyBudget,
      buildsPerMonth: request.buildsPerMonth !== undefined ? request.buildsPerMonth : current.buildsPerMonth,
      ...(perReader
        ? {
            readerMonthlyBudget: request.readerMonthlyBudget !== undefined ? request.readerMonthlyBudget : (current.readerMonthlyBudget ?? null),
            readerRequestsPerMonth:
              request.readerRequestsPerMonth !== undefined ? request.readerRequestsPerMonth : (current.readerRequestsPerMonth ?? null),
          }
        : {}),
    };
    const fields = (Object.keys(updated) as Array<keyof AiFeatureSettings>).filter(
      (field) => JSON.stringify(updated[field]) !== JSON.stringify(current[field]),
    );

    if (fields.length > 0) {
      await this.settings.saveFeature(feature, updated);
      const description =
        updated.enabled !== current.enabled ? `Turned ${updated.enabled ? 'on' : 'off'} ${feature}` : `Changed the settings of ${feature}`;
      this.emitAudit(actor, AuditAction.AiFeatureUpdate, AuditResource.AiSettings, undefined, description, { feature, fields });
      this.events.emit(AI_EVENTS.FEATURE_CHANGED, { feature, enabled: updated.enabled } satisfies AiFeatureChangedEvent);
      if (fields.includes('monthlyBudget') || fields.includes('buildsPerMonth')) this.events.emit(AI_EVENTS.BUDGET_CHANGED);
    }
    return this.getSettings();
  }

  async updateBudget(request: UpdateAiBudgetRequest): Promise<AiSettings> {
    const current = await this.settings.budget();
    const updated = {
      monthlyBudget: request.monthlyBudget !== undefined ? request.monthlyBudget : current.monthlyBudget,
      buildsPerMonth: request.buildsPerMonth !== undefined ? request.buildsPerMonth : current.buildsPerMonth,
    };
    if (updated.monthlyBudget !== current.monthlyBudget || updated.buildsPerMonth !== current.buildsPerMonth) {
      await this.settings.saveBudget(updated);
      this.events.emit(AI_EVENTS.BUDGET_CHANGED);
    }
    return this.getSettings();
  }

  tryIt(slot: AiSlot): Promise<AiTryResult> {
    return this.tryService.run(slot);
  }

  async usage(from?: string, to?: string): Promise<AiUsageReport> {
    const range = usageRange(from, to);
    const [groups, connections, jobs, errors] = await Promise.all([
      this.ledger.groups(range.from, range.to),
      this.connections.list(),
      this.ledger.costliestJobs(range.from, range.to, COSTLIEST_JOBS),
      this.ledger.recentErrors(range.from, range.to, RECENT_ERRORS),
    ]);
    const names = new Map(connections.map((connection) => [connection.id, connection.name]));
    const labels = await this.bridge.jobLabels(jobs.map((job) => job.jobId));

    const byModel = new Map<string, { model: string; connectionId: number | null; groups: AiUsageGroup[] }>();
    for (const group of groups) {
      const key = `${group.connectionId ?? 0}\u0000${group.model}`;
      const entry = byModel.get(key) ?? { model: group.model, connectionId: group.connectionId, groups: [] };
      entry.groups.push(group);
      byModel.set(key, entry);
    }

    return {
      from: range.from,
      to: range.to,
      months: aiMonthRange(range.from, range.to).map((month) => ({ month, ...sumGroups(groups.filter((group) => group.month === month)) })),
      byFeature: [...new Set(groups.map((group) => group.feature))]
        .map((feature) => ({ feature, ...sumGroups(groups.filter((group) => group.feature === feature)) }))
        .sort((a, b) => b.costMicros - a.costMicros || b.requests - a.requests),
      byModel: [...byModel.values()]
        .map((entry) => ({
          model: entry.model,
          connectionId: entry.connectionId,
          connectionName: entry.connectionId === null ? null : (names.get(entry.connectionId) ?? null),
          ...sumGroups(entry.groups),
        }))
        .sort((a, b) => b.costMicros - a.costMicros || b.requests - a.requests),
      costliestJobs: jobs.map((job) => ({ ...job, label: labels.get(job.jobId) ?? null })),
      recentErrors: errors.map((error) => ({ ...error, at: error.at.toISOString() })),
    };
  }

  async usageCsv(from?: string, to?: string): Promise<{ filename: string; csv: string }> {
    const range = usageRange(from, to);
    const [groups, connections] = await Promise.all([this.ledger.groups(range.from, range.to), this.connections.list()]);
    const names = new Map(connections.map((connection) => [connection.id, connection.name]));
    const lines = [CSV_COLUMNS.join(',')];
    for (const group of groups) {
      lines.push(
        [
          group.month,
          group.feature,
          group.slot,
          group.connectionId === null ? '' : (names.get(group.connectionId) ?? `#${group.connectionId}`),
          group.model,
          group.requests,
          group.errors,
          group.inputTokens,
          group.outputTokens,
          group.reasoningTokens,
          group.cachedTokens,
          (group.costMicros / 1_000_000).toFixed(6),
          group.unknownCostRequests,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return { filename: `ai-usage-${range.from}-to-${range.to}.csv`, csv: `${lines.join('\n')}\n` };
  }

  private emitAudit(
    actor: AiActor,
    action: AuditAction,
    resource: AuditResource,
    resourceId: number | undefined,
    description: string,
    meta?: Record<string, unknown>,
  ): void {
    this.audit.emit(AUDIT_EVENT, {
      userId: actor.userId,
      actorUsername: actor.username,
      action,
      resource,
      ...(resourceId !== undefined ? { resourceId } : {}),
      description,
      ...(actor.ip ? { ip: actor.ip } : {}),
      ...(meta ? { meta } : {}),
    });
  }
}

/** Limits outside the feature's own range are refused, not clamped, so the page learns about it. */
function checkedLimits(feature: AiFeatureId, limits: AiFeatureLimits | undefined): AiFeatureLimits {
  if (!limits) return {};
  const ranges = AI_FEATURE_DEFINITIONS[feature].limits;
  const checked: AiFeatureLimits = {};
  for (const [name, value] of Object.entries(limits) as Array<[keyof AiFeatureLimits, number | undefined]>) {
    if (value === undefined) continue;
    const range = ranges[name];
    if (!range) throw new BadRequestException(`${feature} has no limit called ${name}`);
    if (value < range.min || value > range.max) throw new BadRequestException(`${name} must be between ${range.min} and ${range.max}`);
    checked[name] = value;
  }
  return checked;
}

function usageRange(from?: string, to?: string): { from: string; to: string } {
  const end = to ?? aiMonthKey();
  const start = from ?? shiftAiMonth(end, -(DEFAULT_USAGE_MONTHS - 1));
  if (start > end) throw new BadRequestException('from must not be after to');
  if (aiMonthRange(start, end).length > MAX_USAGE_MONTHS) throw new BadRequestException(`Ask for at most ${MAX_USAGE_MONTHS} months at once`);
  return { from: start, to: end };
}

function sumGroups(groups: AiUsageGroup[]): AiUsageTotals {
  const totals: AiUsageTotals = {
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cachedTokens: 0,
    costMicros: 0,
    unknownCostRequests: 0,
    errors: 0,
  };
  for (const group of groups) {
    totals.requests += group.requests;
    totals.inputTokens += group.inputTokens;
    totals.outputTokens += group.outputTokens;
    totals.reasoningTokens += group.reasoningTokens;
    totals.cachedTokens += group.cachedTokens;
    totals.costMicros += group.costMicros;
    totals.unknownCostRequests += group.unknownCostRequests;
    totals.errors += group.errors;
  }
  return totals;
}

/** Quotes a CSV cell, and defuses spreadsheet formulas so a model or connection name can never run as one. */
function csvCell(value: string | number): string {
  const raw = String(value);
  const text = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
  return /[",\n\r]/.test(text) || text !== raw ? `"${text.replace(/"/g, '""')}"` : text;
}
