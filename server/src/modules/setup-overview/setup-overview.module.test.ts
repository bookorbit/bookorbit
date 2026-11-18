import { Test } from '@nestjs/testing';
import { describe, expect, it, vi } from 'vitest';

import { DB } from '../../db';
import { DeliveryRepository, type DeliverySummary } from './delivery.repository';
import { SetupOverviewModule } from './setup-overview.module';
import { SetupOverviewService } from './setup-overview.service';

const SUMMARY: DeliverySummary = {
  koboDevices: 1,
  koboKepub: 1,
  koboTwoWay: 1,
  koreaderAccounts: 2,
  opdsAccounts: 0,
  emailProviders: 1,
  emailShared: 0,
  emailRecipients: 2,
};

/**
 * The module wires its own contributor, so a card it owns reaches the page without another module
 * having to remember it.
 */
describe('SetupOverviewModule', () => {
  it('registers the delivery card and serves it', async () => {
    const moduleRef = await Test.createTestingModule({ imports: [SetupOverviewModule] })
      .overrideProvider(DB)
      .useValue({})
      .overrideProvider(DeliveryRepository)
      .useValue({ summary: vi.fn().mockResolvedValue(SUMMARY) })
      .compile();
    await moduleRef.init();

    const overview = await moduleRef.get(SetupOverviewService).get({ id: 1 } as never);

    expect(overview.cards.map((c) => c.id)).toEqual(['out']);
    expect(overview.cards[0].shape).toBe('fan');
    expect(overview.stats).toEqual([expect.objectContaining({ code: 'outlets', value: 3 })]);
    // Places to go are not a map on their own: with no way in, there is nothing to draw them from.
    expect(overview.map).toBeNull();
    await moduleRef.close();
  });
});
