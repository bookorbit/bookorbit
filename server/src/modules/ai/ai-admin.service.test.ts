import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { AuditAction } from '@bookorbit/types';

import type { AppSettingsService } from '../app-settings/app-settings.service';
import { AUDIT_EVENT, AuditEventsService, type AuditEventPayload } from '../audit/audit-events.service';
import { AiAdminService } from './ai-admin.service';
import type { AiBudgetService } from './ai-budget.service';
import type { AiConnectionTestService } from './ai-connection-test.service';
import type { AiConnectionService } from './ai-connection.service';
import { AI_EVENTS, AiEventsService } from './ai-events.service';
import { AiJobsBridge } from './ai-jobs-bridge.service';
import type { AiLedgerRepository, AiUsageGroup } from './ai-ledger.repository';
import { AiSettingsService } from './ai-settings.service';
import type { AiTryService } from './ai-try.service';

const ACTOR = { userId: 1, username: 'admin', ip: '10.0.0.1' };

function group(overrides: Partial<AiUsageGroup>): AiUsageGroup {
  return {
    month: '2026-10',
    feature: 'story-guides',
    slot: 'fast',
    connectionId: 1,
    model: 'model-a',
    requests: 1,
    errors: 0,
    inputTokens: 100,
    outputTokens: 10,
    reasoningTokens: 0,
    cachedTokens: 0,
    costMicros: 1000,
    unknownCostRequests: 0,
    ...overrides,
  };
}

function setup(options: { groups?: AiUsageGroup[]; connectionNames?: Record<number, string> } = {}) {
  const values = new Map<string, string>();
  const appSettings = {
    getValue: (key: string) => Promise.resolve(values.get(key) ?? null),
    getValues: (keys: string[]) => Promise.resolve(new Map(keys.filter((key) => values.has(key)).map((key) => [key, values.get(key) as string]))),
    setValue: (key: string, value: string) => Promise.resolve(void values.set(key, value)),
  };
  const settings = new AiSettingsService(appSettings as unknown as AppSettingsService);
  const names = options.connectionNames ?? { 1: 'Main', 2: 'Backup' };
  const connections = {
    getRow: vi.fn((id: number) =>
      id in names ? Promise.resolve({ id, name: names[id] }) : Promise.reject(new NotFoundException('AI connection not found')),
    ),
    list: vi.fn(() => Promise.resolve(Object.entries(names).map(([id, name]) => ({ id: Number(id), name })))),
    remove: vi.fn(() => Promise.resolve()),
  };
  const ledger = {
    groups: vi.fn(() => Promise.resolve(options.groups ?? [])),
    costliestJobs: vi.fn(() => Promise.resolve([{ jobId: 'job-1', feature: 'story-guides', requests: 3, costMicros: 9000 }])),
    recentErrors: vi.fn(() => Promise.resolve([])),
  };
  const bridge = new AiJobsBridge();
  const events = new AiEventsService();
  const audit = new AuditEventsService();
  const audits: AuditEventPayload[] = [];
  audit.on(AUDIT_EVENT, (payload: AuditEventPayload) => audits.push(payload));
  const emitted: string[] = [];
  for (const name of Object.values(AI_EVENTS)) events.on(name, () => emitted.push(name));

  const service = new AiAdminService(
    connections as unknown as AiConnectionService,
    {} as AiConnectionTestService,
    {} as AiTryService,
    settings,
    {} as AiBudgetService,
    ledger as unknown as AiLedgerRepository,
    bridge,
    events,
    audit,
  );
  return { service, settings, connections, ledger, bridge, audits, emitted };
}

describe('AiAdminService', () => {
  describe('features', () => {
    it('refuses the first switch on without the privacy confirmation', async () => {
      const { service, audits } = setup();
      const error = await service.updateFeature('story-guides', { enabled: true }, ACTOR).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toMatchObject({ errorCode: 'AI_PRIVACY_CONFIRMATION_REQUIRED' });
      expect(audits).toEqual([]);
    });

    it('records the confirmation once, and later switches need none', async () => {
      const { service, settings, audits, emitted } = setup();
      const first = await service.updateFeature('story-guides', { enabled: true, confirmPrivacy: true }, ACTOR);
      expect(first.features[0].settings.enabled).toBe(true);
      expect(first.features[0].privacy).toMatchObject({ userId: 1, username: 'admin' });
      expect(audits.map((entry) => entry.action)).toEqual([AuditAction.AiPrivacyConfirm, AuditAction.AiFeatureUpdate]);
      expect(audits[1].meta).toEqual({ feature: 'story-guides', fields: ['enabled'] });
      expect(emitted).toEqual([AI_EVENTS.FEATURE_CHANGED]);

      await service.updateFeature('story-guides', { enabled: false }, ACTOR);
      await service.updateFeature('story-guides', { enabled: true }, ACTOR);
      expect((await settings.features())['story-guides'].enabled).toBe(true);
      expect(audits.filter((entry) => entry.action === AuditAction.AiPrivacyConfirm)).toHaveLength(1);
    });

    it('checks limits against the feature, and keeps the ones not sent', async () => {
      const { service, settings } = setup();
      await expect(service.updateFeature('story-guides', { limits: { concurrentBuilds: 9 } }, ACTOR)).rejects.toThrow(
        'concurrentBuilds must be between 1 and 3',
      );
      await service.updateFeature('story-guides', { limits: { concurrentBuilds: 2 } }, ACTOR);
      expect((await settings.features())['story-guides'].limits).toEqual({ maxWords: 400_000, concurrentBuilds: 2 });
    });

    it('announces a budget change when a feature cap moves, and stays quiet when nothing changed', async () => {
      const { service, audits, emitted } = setup();
      await service.updateFeature('story-guides', { monthlyBudget: 5 }, ACTOR);
      expect(emitted).toEqual([AI_EVENTS.FEATURE_CHANGED, AI_EVENTS.BUDGET_CHANGED]);
      await service.updateFeature('story-guides', { monthlyBudget: 5 }, ACTOR);
      expect(emitted).toHaveLength(2);
      expect(audits).toHaveLength(1);
    });

    it('answers 404 for a feature it does not know', async () => {
      await expect(setup().service.updateFeature('future-feature', { enabled: true }, ACTOR)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('slots', () => {
    it('drops prices, the output limit and health when the model changes, and keeps them when it does not', async () => {
      const { service, settings, emitted } = setup();
      await service.updateSlots({ fast: { connectionId: 1, model: 'model-a', prices: { input: 1, output: 2 }, maxOutputTokens: 9000 } });
      await settings.setSlotHealth('fast', { failingSince: '2026-11-01T00:00:00.000Z', code: 'model-missing', model: 'model-a', reason: 'Gone' });

      const same = await service.updateSlots({ fast: { connectionId: 1, model: 'model-a', jsonMode: 'instructions' } });
      expect(same.changed).toEqual(['fast']);
      expect(same.slots.fast).toMatchObject({ prices: { input: 1, output: 2 }, maxOutputTokens: 9000, jsonMode: 'instructions' });
      expect(same.slotHealth.fast).toBeDefined();

      const moved = await service.updateSlots({ fast: { connectionId: 2, model: 'model-b' } });
      expect(moved.slots.fast).toEqual({
        connectionId: 2,
        model: 'model-b',
        prices: null,
        jsonMode: 'instructions',
        maxOutputTokens: null,
        effort: 'auto',
      });
      expect(moved.slotHealth.fast).toBeUndefined();
      expect(emitted.filter((name) => name === AI_EVENTS.SLOTS_CHANGED)).toHaveLength(3);
    });

    it('keeps the effort for the same model, resets it for a new one, and clears health when it changes', async () => {
      const { service, settings } = setup();
      await service.updateSlots({ fast: { connectionId: 1, model: 'model-a', effort: 'high' } });
      const kept = await service.updateSlots({ fast: { connectionId: 1, model: 'model-a', jsonMode: 'json' } });
      expect(kept.slots.fast.effort).toBe('high');

      await settings.setSlotHealth('fast', {
        failingSince: '2026-11-01T00:00:00.000Z',
        code: 'effort-rejected',
        model: 'model-a',
        reason: 'Refused',
      });
      const lowered = await service.updateSlots({ fast: { connectionId: 1, model: 'model-a', effort: 'low' } });
      expect(lowered.slots.fast.effort).toBe('low');
      expect(lowered.slotHealth.fast).toBeUndefined();

      const moved = await service.updateSlots({ fast: { connectionId: 1, model: 'model-b' } });
      expect(moved.slots.fast.effort).toBe('auto');
    });

    it('reports no change for the same values and leaves the other slot alone', async () => {
      const { service } = setup();
      await service.updateSlots({ careful: { connectionId: 1, model: 'model-a' } });
      const result = await service.updateSlots({ careful: { connectionId: 1, model: ' model-a ' } });
      expect(result.changed).toEqual([]);
      expect(result.slots.fast.model).toBeNull();
    });

    it('needs both a connection and a model, and a connection that exists', async () => {
      const { service } = setup();
      await expect(service.updateSlots({ fast: { connectionId: null, model: 'model-a' } })).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.updateSlots({ fast: { connectionId: 7, model: 'model-a' } })).rejects.toBeInstanceOf(NotFoundException);
      const cleared = await service.updateSlots({ fast: { connectionId: 1, model: null } });
      expect(cleared.slots.fast.connectionId).toBeNull();
    });

    it('lists the slots each feature is missing', async () => {
      const { service } = setup();
      await service.updateSlots({ fast: { connectionId: 1, model: 'model-a' } });
      expect((await service.getSettings()).features[0].missingSlots).toEqual(['careful']);
    });
  });

  describe('deleting a connection', () => {
    it('is refused while a slot uses it', async () => {
      const { service, connections } = setup();
      await service.updateSlots({ fast: { connectionId: 1, model: 'model-a' }, careful: { connectionId: 1, model: 'model-b' } });
      const error = await service.deleteConnection(1).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        errorCode: 'AI_CONNECTION_IN_USE',
        errorMeta: { slots: 'fast,careful', unfinishedJobs: 0 },
      });
      expect(connections.remove).not.toHaveBeenCalled();
    });

    it('is refused while an unfinished job uses it', async () => {
      const { service, bridge, connections } = setup();
      bridge.register({ countUnfinishedJobsUsing: (id) => Promise.resolve(id === 2 ? 1 : 0) });
      await expect(service.deleteConnection(2)).rejects.toMatchObject({
        response: { errorCode: 'AI_CONNECTION_IN_USE', errorMeta: { slots: '', unfinishedJobs: 1 } },
      });
      await service.deleteConnection(1);
      expect(connections.remove).toHaveBeenCalledWith(1);
    });

    it('answers 404 for a connection that does not exist', async () => {
      await expect(setup().service.deleteConnection(7)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('budget', () => {
    it('saves what was sent, keeps the rest, and announces only a real change', async () => {
      const { service, emitted } = setup();
      const first = await service.updateBudget({ monthlyBudget: 10 });
      expect(first.budget).toEqual({ monthlyBudget: 10, buildsPerMonth: null });
      const second = await service.updateBudget({ buildsPerMonth: 4 });
      expect(second.budget).toEqual({ monthlyBudget: 10, buildsPerMonth: 4 });
      await service.updateBudget({ monthlyBudget: 10 });
      expect(emitted).toEqual([AI_EVENTS.BUDGET_CHANGED, AI_EVENTS.BUDGET_CHANGED]);
    });
  });

  describe('usage', () => {
    it('adds up months, features and models, and names connections and jobs', async () => {
      const { service, bridge, ledger } = setup({
        groups: [
          group({ month: '2026-09', costMicros: 500 }),
          group({ month: '2026-10', slot: 'careful', model: 'model-b', connectionId: 2, costMicros: 4000, errors: 1 }),
          group({ month: '2026-10', feature: 'connection-test', slot: 'test', costMicros: 0, unknownCostRequests: 1 }),
          group({ month: '2026-10', connectionId: null, model: 'gone', costMicros: 100 }),
        ],
      });
      bridge.register({ jobLabels: () => Promise.resolve(new Map([['job-1', 'Pride and Prejudice']])) });
      const report = await service.usage('2026-09', '2026-11');

      expect(ledger.groups).toHaveBeenCalledWith('2026-09', '2026-11');
      expect(report.months.map((month) => [month.month, month.requests, month.costMicros])).toEqual([
        ['2026-09', 1, 500],
        ['2026-10', 3, 4100],
        ['2026-11', 0, 0],
      ]);
      expect(report.byFeature.map((entry) => [entry.feature, entry.requests, entry.errors])).toEqual([
        ['story-guides', 3, 1],
        ['connection-test', 1, 0],
      ]);
      expect(report.byModel.map((entry) => [entry.model, entry.connectionName, entry.costMicros])).toEqual([
        ['model-b', 'Backup', 4000],
        ['model-a', 'Main', 500],
        ['gone', null, 100],
      ]);
      expect(report.costliestJobs).toEqual([
        { jobId: 'job-1', feature: 'story-guides', requests: 3, costMicros: 9000, label: 'Pride and Prejudice' },
      ]);
    });

    it('refuses a reversed or too long range', async () => {
      const { service } = setup();
      await expect(service.usage('2026-10', '2026-09')).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.usage('2023-01', '2026-10')).rejects.toThrow('at most 36 months');
    });

    it('writes a CSV whose cells can never run as a spreadsheet formula', async () => {
      const { service } = setup({
        groups: [group({ model: '=HYPERLINK("http://example.test")', connectionId: 1 }), group({ model: 'plain', connectionId: 3 })],
        connectionNames: { 1: '@Main, the "fast" one' },
      });
      const { filename, csv } = await service.usageCsv('2026-10', '2026-10');
      expect(filename).toBe('ai-usage-2026-10-to-2026-10.csv');
      const lines = csv.trimEnd().split('\n');
      expect(lines[0]).toBe(
        'month,feature,slot,connection,model,requests,errors,input_tokens,output_tokens,reasoning_tokens,cached_tokens,cost_usd,unknown_cost_requests',
      );
      expect(lines[1]).toBe(`2026-10,story-guides,fast,"'@Main, the ""fast"" one","'=HYPERLINK(""http://example.test"")",1,0,100,10,0,0,0.001000,0`);
      expect(lines[2]).toContain(',#3,plain,');
    });
  });
});
