import { describe, it, expect, vi, beforeEach } from 'vitest';

import { ReadwiseController } from './readwise.controller';

const mockSettingsService = {
  getSettings: vi.fn(),
  upsertSettings: vi.fn(),
  validateToken: vi.fn(),
};

const mockUser = { id: 7, isSuperuser: false, permissions: [] };

function makeController() {
  return new ReadwiseController(mockSettingsService as any);
}

describe('ReadwiseController', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('getSettings delegates to service', async () => {
    mockSettingsService.getSettings.mockResolvedValue({ tokenConfigured: false });
    const result = await makeController().getSettings(mockUser as any);
    expect(result).toEqual({ tokenConfigured: false });
    expect(mockSettingsService.getSettings).toHaveBeenCalledWith(7);
  });

  it('upsertSettings delegates to service', async () => {
    mockSettingsService.upsertSettings.mockResolvedValue({ tokenConfigured: true });
    const dto = { apiToken: 'tok', enabled: true };
    const result = await makeController().upsertSettings(mockUser as any, dto);
    expect(result).toEqual({ tokenConfigured: true });
    expect(mockSettingsService.upsertSettings).toHaveBeenCalledWith(7, dto);
  });

  it('validateToken delegates to service', async () => {
    mockSettingsService.validateToken.mockResolvedValue({ valid: true });
    const result = await makeController().validateToken(mockUser as any, { token: 'tok' });
    expect(result).toEqual({ valid: true });
    expect(mockSettingsService.validateToken).toHaveBeenCalledWith(7, 'tok');
  });
});
