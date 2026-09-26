import { ProviderConfigService } from './provider-config.service';
import { ProviderLinkSettingsController } from './provider-link-settings.controller';
import type { Mocked } from 'vitest';

describe('ProviderLinkSettingsController', () => {
  it('returns only settings needed to build provider links', async () => {
    const service = {
      getLinkSettings: vi.fn().mockResolvedValue({ amazonDomain: 'amazon.de' }),
    } as unknown as Mocked<ProviderConfigService>;
    const controller = new ProviderLinkSettingsController(service);

    await expect(controller.getSettings()).resolves.toEqual({ amazonDomain: 'amazon.de' });
    expect(service.getLinkSettings).toHaveBeenCalledOnce();
  });
});
