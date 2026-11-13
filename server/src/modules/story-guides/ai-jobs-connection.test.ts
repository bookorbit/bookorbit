import type { AiSlot } from '@bookorbit/types';

import type { AiBudgetService } from '../ai/ai-budget.service';
import type { AiClient } from '../ai/ai-client.service';
import type { AiRequest, AiSlotChoice } from '../ai/ai-client.types';
import type { AiSettingsService } from '../ai/ai-settings.service';
import type { AiRequest as AiJobRequest } from '../ai-jobs/ai-jobs.ports';
import { createAiJobsPorts } from './ai-jobs-connection';

function setup(slots: Partial<Record<AiSlot, AiSlotChoice>>) {
  const sent: AiRequest[] = [];
  const client = {
    resolveSlot: vi.fn((slot: AiSlot) => {
      const choice = slots[slot];
      return choice ? Promise.resolve(choice) : Promise.reject(new Error('slot-empty'));
    }),
    complete: vi.fn((request: AiRequest) => Promise.resolve(void sent.push(request))),
  };
  const ports = createAiJobsPorts({
    client: client as unknown as AiClient,
    budget: {} as AiBudgetService,
    settings: {} as AiSettingsService,
    connections: { get: vi.fn() },
    tests: { testSaved: vi.fn() },
  });
  return { ports, sent };
}

const careful = (overrides: Partial<AiSlotChoice> = {}): AiSlotChoice => ({
  slot: 'careful',
  connectionId: 1,
  model: 'm',
  prices: { input: 1, output: 4 },
  jsonMode: 'auto',
  ...overrides,
});
const jobRequest = (use: AiJobRequest['use']) =>
  ({ slot: 'careful', feature: 'story-guides', system: 's', user: 'u', maxOutputTokens: 100, use }) as AiJobRequest;

describe('createAiJobsPorts', () => {
  it('records the effort a slot chose, and nothing for a slot left on automatic', async () => {
    const { ports } = setup({ careful: careful({ effort: 'high' }), fast: careful({ slot: 'fast' }) });
    await expect(ports.slots.resolve('story-guides', ['careful', 'fast'])).resolves.toEqual({
      models: { careful: { connectionId: 1, model: 'm', effort: 'high' }, fast: { connectionId: 1, model: 'm' } },
      missing: [],
    });
  });

  it('keeps the effort a job recorded after the slot moves to another level', async () => {
    const { ports, sent } = setup({ careful: careful({ effort: 'low' }) });
    await ports.client.complete(jobRequest({ connectionId: 1, model: 'm', effort: 'high' }));
    await ports.client.complete(jobRequest({ connectionId: 1, model: 'm' }));
    expect(sent[0]!.use).toMatchObject({ model: 'm', prices: { input: 1, output: 4 }, effort: 'high' });
    expect(sent[1]!.use?.effort).toBeUndefined();
  });

  it('keeps the effort a job recorded after the slot moves to another model', async () => {
    const { ports, sent } = setup({ careful: careful({ model: 'n', effort: 'low' }) });
    await ports.client.complete(jobRequest({ connectionId: 1, model: 'm', effort: 'max' }));
    expect(sent[0]!.use).toEqual({ slot: 'careful', connectionId: 1, model: 'm', prices: null, jsonMode: 'auto', effort: 'max' });
  });
});
