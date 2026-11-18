import { describe, expect, it, vi } from 'vitest';
import type { SetupFlowCard, SetupFlowId, SetupMapFragment, SetupMapLane } from '@bookorbit/types';

import type { RequestUser } from '../../common/types/request-user';
import type { SetupFlowContribution, SetupFlowContributor } from './setup-flow';
import { SetupFlowRegistry } from './setup-flow.registry';
import { SetupOverviewService } from './setup-overview.service';

const viewer = { id: 1 } as RequestUser;

function lane(id: SetupMapLane['id'], stations: string[], into: string | null = null): SetupMapLane {
  return {
    id,
    caption: { key: `c.${id}` },
    entries: [],
    stations: stations.map((s) => ({ id: s, icon: 'check', label: { key: s }, sub: null })),
    into,
    note: null,
    branch: null,
  };
}

function contributor(id: SetupFlowId, result: SetupFlowContribution | Error): SetupFlowContributor {
  return { id, build: vi.fn(() => (result instanceof Error ? Promise.reject(result) : Promise.resolve(result))) };
}

const card = (id: SetupFlowId) => ({ id }) as SetupFlowCard;

function service(...contributors: SetupFlowContributor[]) {
  const registry = new SetupFlowRegistry();
  for (const c of contributors) registry.register(c);
  return new SetupOverviewService(registry);
}

describe('SetupOverviewService', () => {
  it('keeps the page when one flow fails, losing only that flow', async () => {
    const overview = await service(
      contributor('ingest', new Error('disk gone')),
      contributor('out', { card: card('out'), stats: [{ code: 'outlets', label: { key: 'x' }, value: 2 }], map: null }),
    ).get(viewer);
    expect(overview.cards.map((c) => c.id)).toEqual(['out']);
    expect(overview.stats.map((s) => s.code)).toEqual(['outlets']);
  });

  it('orders lanes the way a book meets them, whichever flow registered first', async () => {
    const asked: SetupMapFragment = { lanes: [lane('asked', ['searched'], 'dock-files')] };
    const dock: SetupMapFragment = { lanes: [lane('disk', ['scanned']), lane('dropped', ['dock-read', 'dock-files'])] };
    const overview = await service(
      contributor('requests', { card: null, stats: [], map: asked }),
      contributor('ingest', { card: null, stats: [], map: dock }),
    ).get(viewer);
    expect(overview.map?.lanes.map((l) => l.id)).toEqual(['asked', 'dropped', 'disk']);
    expect(overview.map?.lanes[0]?.into).toBe('dock-files');
  });

  it('sends a lane to the library when the station it joins was never drawn', async () => {
    const overview = await service(
      contributor('ingest', new Error('no dock')),
      contributor('requests', { card: null, stats: [], map: { lanes: [lane('asked', ['searched'], 'dock-files')] } }),
      contributor('metadata', {
        card: null,
        stats: [],
        map: { services: [{ id: 'metadata', icon: 'tag', label: { key: 'm' }, sub: null, asks: 'dock-matched' }] },
      }),
    ).get(viewer);
    expect(overview.map?.lanes[0]?.into).toBeNull();
    expect(overview.map?.services[0]?.asks).toBeNull();
  });

  it('draws no map when no flow says how a book gets in', async () => {
    const overview = await service(contributor('out', { card: card('out'), stats: [], map: { out: [] } })).get(viewer);
    expect(overview.map).toBeNull();
  });
});
