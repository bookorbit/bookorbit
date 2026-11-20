import { AI_SETTING_KEYS } from '../../common/constants/app-settings.constants';
import type { AppSettingsService } from '../app-settings/app-settings.service';
import { AiSettingsService } from './ai-settings.service';

function setup(stored: Record<string, string> = {}) {
  const values = new Map(Object.entries(stored));
  const appSettings = {
    getValue: (key: string) => Promise.resolve(values.get(key) ?? null),
    getValues: (keys: string[]) => Promise.resolve(new Map(keys.filter((key) => values.has(key)).map((key) => [key, values.get(key) as string]))),
    setValue: (key: string, value: string) => Promise.resolve(void values.set(key, value)),
  };
  return { values, service: new AiSettingsService(appSettings as unknown as AppSettingsService) };
}

describe('AiSettingsService', () => {
  it('has empty slots, features off with their default limits, and no budget when nothing is stored', async () => {
    const snapshot = await setup().service.snapshot();
    expect(snapshot.slots.fast).toEqual({ connectionId: null, model: null, prices: null, jsonMode: 'auto', maxOutputTokens: null, effort: 'auto' });
    expect(snapshot.features['story-guides']).toEqual({
      enabled: false,
      limits: { maxWords: 400_000, concurrentBuilds: 1 },
      monthlyBudget: null,
      buildsPerMonth: null,
    });
    expect(snapshot.budget).toEqual({ monthlyBudget: null, buildsPerMonth: null });
    expect(snapshot.slotHealth).toEqual({});
    expect(snapshot.privacy).toEqual({});
  });

  it('degrades values it does not understand without dropping the rest', async () => {
    const { service } = setup({
      [AI_SETTING_KEYS.SLOTS]: JSON.stringify({
        fast: { connectionId: 3, model: 'm', jsonMode: 'telepathy', effort: 'ludicrous', prices: { input: 'free', output: 2 } },
        careful: 'nonsense',
        turbo: { connectionId: 9 },
      }),
      [AI_SETTING_KEYS.FEATURES]: JSON.stringify({
        'story-guides': { enabled: true, limits: { maxWords: 5, concurrentBuilds: 2 } },
        'future-feature': { enabled: true },
      }),
      [AI_SETTING_KEYS.SLOT_HEALTH]: JSON.stringify({ fast: { failingSince: '2026-11-01T00:00:00Z', code: 'from-the-future', model: 'm' } }),
      [AI_SETTING_KEYS.BUDGET]: '{not json',
    });
    const snapshot = await service.snapshot();
    expect(snapshot.slots.fast).toEqual({ connectionId: 3, model: 'm', prices: null, jsonMode: 'auto', maxOutputTokens: null, effort: 'auto' });
    expect(snapshot.slots.careful.connectionId).toBeNull();
    expect(snapshot.features['story-guides']).toMatchObject({ enabled: true, limits: { maxWords: 400_000, concurrentBuilds: 2 } });
    expect(snapshot.slotHealth.fast).toMatchObject({ code: 'provider-error', model: 'm' });
    expect(snapshot.budget).toEqual({ monthlyBudget: null, buildsPerMonth: null });
  });

  it('reads a slot effort level it knows', async () => {
    const { service } = setup({ [AI_SETTING_KEYS.SLOTS]: JSON.stringify({ careful: { connectionId: 3, model: 'm', effort: 'xhigh' } }) });
    expect((await service.slots()).careful.effort).toBe('xhigh');
  });

  it('keeps keys a newer server wrote when it saves', async () => {
    const { service, values } = setup({
      [AI_SETTING_KEYS.FEATURES]: JSON.stringify({ 'future-feature': { enabled: true } }),
      [AI_SETTING_KEYS.SLOTS]: JSON.stringify({ turbo: { connectionId: 9 } }),
    });
    const features = await service.features();
    await service.saveFeature('story-guides', { ...features['story-guides'], enabled: true });
    await service.saveSlots(await service.slots());
    expect(JSON.parse(values.get(AI_SETTING_KEYS.FEATURES) as string)).toMatchObject({
      'future-feature': { enabled: true },
      'story-guides': { enabled: true },
    });
    expect(JSON.parse(values.get(AI_SETTING_KEYS.SLOTS) as string)).toHaveProperty('turbo');
  });

  it('writes and clears slot health without touching the slots', async () => {
    const { service, values } = setup();
    await service.setSlotHealth('fast', {
      failingSince: '2026-11-09T00:00:00Z',
      code: 'model-missing',
      reason: 'Model no longer available',
      model: 'm',
    });
    await service.setSlotHealth('careful', {
      failingSince: '2026-11-09T00:00:00Z',
      code: 'model-missing',
      reason: 'Model no longer available',
      model: 'n',
    });
    await service.setSlotHealth('fast', null);
    expect(Object.keys(await service.slotHealth())).toEqual(['careful']);
    expect(values.has(AI_SETTING_KEYS.SLOTS)).toBe(false);
  });

  it('knows only features this server has, and whether they are on', async () => {
    const { service } = setup({ [AI_SETTING_KEYS.FEATURES]: JSON.stringify({ 'story-guides': { enabled: true } }) });
    await expect(service.isFeatureEnabled('story-guides')).resolves.toBe(true);
    await expect(service.isFeatureEnabled('constructor')).resolves.toBe(false);
  });
});
