import { describe, expect, it, vi } from 'vitest';
import { ALL_METADATA_FIELDS, type FieldPreference, type MetadataFetchPreferences } from '@bookorbit/types';

import type { SetupFlowRegistry } from '../setup-overview/setup-flow.registry';
import type { MetadataPreferencesService } from './metadata-preferences.service';
import { MetadataPreferencesSetupFlow } from './metadata-preferences.setup-flow';

function prefs(over: Partial<Record<string, FieldPreference>> = {}, options?: MetadataFetchPreferences['options']): MetadataFetchPreferences {
  const fields = Object.fromEntries(
    ALL_METADATA_FIELDS.map((field) => [field, over[field] ?? { enabled: true, providers: ['google', 'hardcover'], mergeStrategy: 'fillMissing' }]),
  ) as MetadataFetchPreferences['fields'];
  return { fields, options };
}

function build(value: MetadataFetchPreferences) {
  const registry = { register: vi.fn() } as unknown as SetupFlowRegistry;
  const flow = new MetadataPreferencesSetupFlow(registry, { getGlobal: vi.fn().mockResolvedValue(value) } as unknown as MetadataPreferencesService);
  return { flow, registry };
}

async function card(value: MetadataFetchPreferences) {
  return (await build(value).flow.build()).card;
}

describe('MetadataPreferencesSetupFlow', () => {
  it('registers itself with the setup registry', () => {
    const { flow, registry } = build(prefs());
    flow.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(flow);
  });

  it('counts each provider once however many fields name it', async () => {
    const { stats } = await build(prefs()).flow.build();
    expect(stats).toEqual([{ code: 'providers', label: { key: 'setupOverview.metadata.stats.providers', values: { count: 2 } }, value: 2 }]);
  });

  it('names the fields the app already names, rather than keeping a second copy', async () => {
    const built = await card(prefs());
    expect(built?.table?.rows[0][0].text).toEqual({ key: 'settings.metadata.fields.title' });
  });

  it('shows the provider order by display name, untranslated', async () => {
    const built = await card(prefs());
    expect(built?.table?.rows[0][1].text).toEqual({ key: 'raw', values: { text: 'Google Books · Hardcover' } });
  });

  it('keeps the key of a provider an admin registered, which is the name they gave it', async () => {
    const built = await card(prefs({ title: { enabled: true, providers: ['my-shelf', 'openLibrary'], mergeStrategy: 'fillMissing' } }));
    expect(built?.table?.rows[0][1].text).toEqual({ key: 'raw', values: { text: 'my-shelf · Open Library' } });
  });

  it('puts itself on the map as the service the dock asks when it matches', async () => {
    const { map } = await build(prefs()).flow.build();
    expect(map?.services).toEqual([
      {
        id: 'metadata',
        icon: 'tag',
        label: { key: 'setupOverview.metadata.map.service' },
        sub: { key: 'setupOverview.metadata.map.serviceSub', values: { count: 2 } },
        asks: 'dock-matched',
      },
    ]);
  });

  it('warns about a field that is fetched with nobody to ask', async () => {
    const built = await card(prefs({ cover: { enabled: true, providers: [], mergeStrategy: 'fillMissing' } }));
    expect(built?.state).toBe('attention');
    expect(built?.warnings[0]).toMatchObject({ code: 'field_without_provider' });
  });

  it('says a field is not fetched rather than showing a strategy for it', async () => {
    const built = await card(prefs({ title: { enabled: false, providers: [], mergeStrategy: 'fillMissing' } }));
    expect(built?.table?.rows[0][2].text).toEqual({ key: 'setupOverview.metadata.cells.notFetched' });
  });
});
