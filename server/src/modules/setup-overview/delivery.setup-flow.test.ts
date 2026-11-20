import { describe, expect, it, vi } from 'vitest';

import type { DeliveryRepository, DeliverySummary } from './delivery.repository';
import { DeliverySetupFlow } from './delivery.setup-flow';
import type { SetupFlowRegistry } from './setup-flow.registry';

const EMPTY: DeliverySummary = {
  koboDevices: 0,
  koboKepub: 0,
  koboTwoWay: 0,
  koreaderAccounts: 0,
  opdsAccounts: 0,
  emailProviders: 0,
  emailShared: 0,
  emailRecipients: 0,
};

function build(summary: Partial<DeliverySummary> = {}) {
  const registry = { register: vi.fn() } as unknown as SetupFlowRegistry;
  const flow = new DeliverySetupFlow(registry, { summary: vi.fn().mockResolvedValue({ ...EMPTY, ...summary }) } as unknown as DeliveryRepository);
  return { flow, registry };
}

async function card(summary: Partial<DeliverySummary> = {}) {
  return (await build(summary).flow.build()).card;
}

describe('DeliverySetupFlow', () => {
  it('registers itself with the setup registry', () => {
    const { flow, registry } = build();
    flow.onModuleInit();
    expect(registry.register).toHaveBeenCalledWith(flow);
  });

  it('leaves the card out when nothing has been set up to send to', async () => {
    await expect(build().flow.build()).resolves.toEqual({ card: null, stats: [], map: null });
  });

  it('draws a fan from the library to every way out that exists', async () => {
    const built = await card({ koboDevices: 1, koreaderAccounts: 2, emailProviders: 1, emailRecipients: 2 });
    expect(built?.shape).toBe('fan');
    expect(built?.steps.map((s) => s.id)).toEqual(['library', 'kobo', 'koreader', 'email']);
    expect(built?.steps[0].terminal).toBe(true);
  });

  it('counts the ways out rather than the devices', async () => {
    const { stats } = await build({ koboDevices: 7, emailProviders: 1 }).flow.build();
    expect(stats).toEqual([{ code: 'outlets', label: { key: 'setupOverview.out.stats.places', values: { count: 2 } }, value: 2 }]);
  });

  it('still lists a way out nobody set up, so the table says what exists', async () => {
    const built = await card({ koboDevices: 1 });
    expect(built?.table?.rows).toHaveLength(4);
    expect(built?.table?.rows[2].at(-1)).toMatchObject({ state: 'off' });
  });

  it('puts the same places on the map, without the library they leave from', async () => {
    const { map } = await build({ koboDevices: 2, opdsAccounts: 1 }).flow.build();
    expect(map?.out?.map((o) => o.id)).toEqual(['kobo', 'opds']);
    expect(map?.out?.[0]?.sub).toEqual({ key: 'setupOverview.out.lines.koboA', values: { count: 2 } });
  });

  it('warns when mail is set up with nobody to send to', async () => {
    const built = await card({ emailProviders: 1, emailRecipients: 0 });
    expect(built?.warnings[0]).toMatchObject({ code: 'mail_without_recipient' });
  });
});
