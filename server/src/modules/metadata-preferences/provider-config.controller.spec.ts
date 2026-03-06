import { ProviderConfigController } from './provider-config.controller';
import { ProviderConfigService } from './provider-config.service';

describe('ProviderConfigController', () => {
  let service: jest.Mocked<ProviderConfigService>;
  let controller: ProviderConfigController;

  beforeEach(() => {
    service = {
      getConfig: jest.fn(),
      getProviderStatuses: jest.fn(),
      updateConfig: jest.fn(),
    } as unknown as jest.Mocked<ProviderConfigService>;

    controller = new ProviderConfigController(service);
  });

  it('returns both provider config and computed statuses', async () => {
    const config = {
      google: { enabled: true, apiKey: 'key' },
      amazon: { enabled: true, domain: 'amazon.com', cookie: '' },
      goodreads: { enabled: true },
      hardcover: { enabled: false, apiKey: '' },
      openLibrary: { enabled: true },
    };
    const statuses = [{ key: 'google', enabled: true, configured: true, label: 'Google Books' }];

    service.getConfig.mockResolvedValue(config as never);
    service.getProviderStatuses.mockResolvedValue(statuses as never);

    const result = await controller.getConfig();

    expect(service.getConfig).toHaveBeenCalledTimes(1);
    expect(service.getProviderStatuses).toHaveBeenCalledWith(config);
    expect(result).toEqual({ config, statuses });
  });

  it('delegates config updates', async () => {
    const patch = {
      google: { enabled: false },
      amazon: { cookie: 'session' },
    };
    service.updateConfig.mockResolvedValue({} as never);

    await controller.updateConfig(patch as never);

    expect(service.updateConfig).toHaveBeenCalledWith(patch);
  });
});
