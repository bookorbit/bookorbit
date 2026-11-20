import { describe, expect, it, vi } from 'vitest';
import type { AiConnection } from '@bookorbit/types';

import type { SetupFlowRegistry } from '../setup-overview/setup-flow.registry';
import type { AiConnectionService } from './ai-connection.service';
import type { AiFeatureSettingsMap, AiSettingsService, AiSlotHealthMap } from './ai-settings.service';
import { AiSetupFlow } from './ai.setup-flow';

const CONNECTION = { id: 1, name: 'Anthropic', usable: true } as AiConnection;
const SLOTS = {
  fast: { connectionId: 1, model: 'claude-haiku-5-5' },
  careful: { connectionId: 1, model: 'claude-opus-5' },
  vision: { connectionId: null, model: null },
} as never;
const FEATURES = {
  'story-guides': { enabled: true },
  'vision-scan': { enabled: false },
  'reading-help': { enabled: true },
} as unknown as AiFeatureSettingsMap;

type Over = {
  slots?: unknown;
  features?: AiFeatureSettingsMap;
  health?: AiSlotHealthMap;
  connections?: AiConnection[];
  budget?: { monthlyBudget: number | null; buildsPerMonth: number | null };
};

function build(over: Over = {}) {
  const registry = { register: vi.fn() } as unknown as SetupFlowRegistry;
  const snapshot = vi.fn().mockResolvedValue({
    slots: over.slots ?? SLOTS,
    features: over.features ?? FEATURES,
    budget: over.budget ?? { monthlyBudget: 50, buildsPerMonth: null },
    slotHealth: over.health ?? {},
    privacy: {},
  });
  const flow = new AiSetupFlow(
    registry,
    { snapshot } as unknown as AiSettingsService,
    { list: vi.fn().mockResolvedValue(over.connections ?? [CONNECTION]) } as unknown as AiConnectionService,
  );
  return { flow, registry, snapshot };
}

async function card(over: Over = {}) {
  return (await build(over).flow.build()).card;
}

describe('AiSetupFlow', () => {
  it('registers itself with the setup registry', () => {
    const { flow, registry } = build();
    flow.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(flow);
  });

  it('leaves the card out when no connection exists', async () => {
    await expect(build({ connections: [] }).flow.build()).resolves.toEqual({ card: null, stats: [], map: null });
  });

  it('gives a feature one row per slot it runs on', async () => {
    const built = await card();
    expect(built?.table?.rows).toHaveLength(4);
    expect(built?.table?.rows[0][1].text).toEqual({ key: 'setupOverview.ai.slots.fast' });
  });

  it('marks a switched-off feature as off rather than as a problem', async () => {
    const built = await card();
    const vision = built?.table?.rows.find((row) => row[1].text.key === 'setupOverview.ai.slots.vision');
    expect(vision?.at(-1)).toMatchObject({ state: 'off' });
    expect(built?.warnings).toEqual([]);
  });

  it('warns when a switched-on feature has a slot with no connection', async () => {
    const built = await card({ features: { ...FEATURES, 'vision-scan': { enabled: true } } as AiFeatureSettingsMap });
    expect(built?.state).toBe('attention');
    expect(built?.warnings[0]).toMatchObject({ code: 'slot_without_connection' });
  });

  it('names the failing connection when a slot is in trouble', async () => {
    const health = { fast: { failingSince: 'x', code: 'unauthorized', reason: 'no', model: 'm' } } as unknown as AiSlotHealthMap;
    const built = await card({ health });
    expect(built?.warnings).toContainEqual(expect.objectContaining({ code: 'slot_failing', subject: 'Anthropic' }));
  });

  it('reads the settings once rather than once per concern', async () => {
    const { flow, snapshot } = build();
    await flow.build();
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it('warns once per slot, however many switched-on features share it', async () => {
    const built = await card({
      slots: { fast: { connectionId: null, model: null }, careful: { connectionId: null, model: null }, vision: { connectionId: null, model: null } },
      features: {
        'story-guides': { enabled: true },
        'vision-scan': { enabled: true },
        'reading-help': { enabled: true },
      } as unknown as AiFeatureSettingsMap,
    });
    const keys = built?.warnings.map((w) => w.detail.key) ?? [];
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => key.startsWith('setupOverview.ai.warnings.slotUnset.'))).toBe(true);
  });

  it('does not count a slot pointing at a deleted connection as set', async () => {
    const built = await card({
      slots: { fast: { connectionId: 99, model: 'x' }, careful: { connectionId: 1, model: 'y' }, vision: { connectionId: null, model: null } },
    });
    expect(built?.steps.find((s) => s.id === 'slot')?.lines[1]).toEqual({ key: 'setupOverview.ai.lines.slotB', values: { count: 1, total: 3 } });
  });

  it('marks the budget as money so the page formats it as currency', async () => {
    const built = await build().flow.build();
    expect(built.card?.facts[0]).toEqual({ key: 'setupOverview.ai.facts.budget', values: { amount: 50 }, money: ['amount'] });
    expect(built.map?.services?.[0]).toMatchObject({ id: 'ai', asks: null, sub: { key: 'setupOverview.ai.map.serviceBudget', money: ['amount'] } });
  });

  it('never puts a key or an address on the page', async () => {
    const built = await build({ connections: [{ ...CONNECTION, baseUrl: 'https://secret.example', keyHint: 'ab12' } as AiConnection] }).flow.build();
    const json = JSON.stringify(built);
    expect(json).not.toContain('secret.example');
    expect(json).not.toContain('ab12');
  });
});
