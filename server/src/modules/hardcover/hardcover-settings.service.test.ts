import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { HardcoverSettingsService } from './hardcover-settings.service';

const mockRepo = {
  findSettings: vi.fn(),
  upsertSettings: vi.fn(),
  deleteSettings: vi.fn(),
};

const mockClient = {
  query: vi.fn(),
};

const mockAppSettings = {
  isHardcoverEnabled: vi.fn(),
  setHardcoverEnabled: vi.fn(),
};

function makeService() {
  return new HardcoverSettingsService(mockRepo as any, mockClient as any, mockAppSettings as any);
}

describe('HardcoverSettingsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('isFeatureEnabled', () => {
    it('returns true when enabled', async () => {
      mockAppSettings.isHardcoverEnabled.mockResolvedValue(true);
      expect(await makeService().isFeatureEnabled()).toBe(true);
    });

    it('returns false by default', async () => {
      mockAppSettings.isHardcoverEnabled.mockResolvedValue(false);
      expect(await makeService().isFeatureEnabled()).toBe(false);
    });
  });

  describe('getSettings', () => {
    it('returns defaults when no settings row exists', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      const result = await makeService().getSettings(1);
      expect(result.tokenConfigured).toBe(false);
      expect(result.enabled).toBe(false);
      expect(result.privacySettingId).toBe(3);
    });

    it('returns settings without token when row exists', async () => {
      mockRepo.findSettings.mockResolvedValue({
        apiToken: 'secret',
        enabled: true,
        autoSyncOnStatusChange: true,
        autoSyncOnProgressUpdate: false,
        autoSyncOnRatingChange: true,
        privacySettingId: 1,
        lastSyncedAt: null,
      });
      const result = await makeService().getSettings(1);
      expect(result.tokenConfigured).toBe(true);
      expect(result.enabled).toBe(true);
      expect(result.autoSyncOnProgressUpdate).toBe(false);
      expect((result as any).apiToken).toBeUndefined();
      expect(result.lastSyncedAt).toBeNull();
    });

    it('returns lastSyncedAt as ISO string when set', async () => {
      const syncedAt = new Date('2025-05-01T10:00:00Z');
      mockRepo.findSettings.mockResolvedValue({
        apiToken: 'secret',
        enabled: true,
        autoSyncOnStatusChange: true,
        autoSyncOnProgressUpdate: true,
        autoSyncOnRatingChange: true,
        privacySettingId: 3,
        lastSyncedAt: syncedAt,
      });
      const result = await makeService().getSettings(1);
      expect(result.lastSyncedAt).toBe(syncedAt.toISOString());
    });

    it('returns null lastSyncedAt when no settings row exists', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      const result = await makeService().getSettings(1);
      expect(result.tokenConfigured).toBe(false);
      expect(result.lastSyncedAt).toBeNull();
    });
  });

  describe('upsertSettings', () => {
    it('throws BadRequestException for invalid privacySettingId', async () => {
      await expect(makeService().upsertSettings(1, { privacySettingId: 99 })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when setting empty token without existing settings', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      await expect(makeService().upsertSettings(1, { apiToken: '   ' })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when saving settings without token and no existing row', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      await expect(makeService().upsertSettings(1, { enabled: true })).rejects.toThrow(BadRequestException);
    });

    it('upserts and returns settings', async () => {
      mockRepo.findSettings.mockResolvedValueOnce(undefined).mockResolvedValue({
        apiToken: 'token',
        enabled: true,
        autoSyncOnStatusChange: true,
        autoSyncOnProgressUpdate: true,
        autoSyncOnRatingChange: true,
        privacySettingId: 3,
      });
      mockRepo.upsertSettings.mockResolvedValue({});
      const result = await makeService().upsertSettings(1, { apiToken: 'token' });
      expect(result.tokenConfigured).toBe(true);
      expect(mockRepo.upsertSettings).toHaveBeenCalledWith(1, { apiToken: 'token' });
    });

    it('carries existing token forward when updating settings without a new token', async () => {
      const existing = {
        apiToken: 'saved-token',
        enabled: true,
        autoSyncOnStatusChange: true,
        autoSyncOnProgressUpdate: true,
        autoSyncOnRatingChange: true,
        privacySettingId: 3,
      };
      mockRepo.findSettings.mockResolvedValue(existing);
      mockRepo.upsertSettings.mockResolvedValue({});
      await makeService().upsertSettings(1, { enabled: false });
      expect(mockRepo.upsertSettings).toHaveBeenCalledWith(1, {
        apiToken: 'saved-token',
        enabled: false,
      });
    });
  });

  describe('disconnectUser', () => {
    it('throws NotFoundException when not configured', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      await expect(makeService().disconnectUser(1)).rejects.toThrow(NotFoundException);
    });

    it('deletes settings when configured', async () => {
      mockRepo.findSettings.mockResolvedValue({ apiToken: 'token' });
      mockRepo.deleteSettings.mockResolvedValue(undefined);
      await makeService().disconnectUser(1);
      expect(mockRepo.deleteSettings).toHaveBeenCalledWith(1);
    });
  });

  describe('validateToken', () => {
    it('returns invalid when no settings', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      expect(await makeService().validateToken(1)).toEqual({ valid: false });
    });

    it('returns valid with username on success', async () => {
      mockRepo.findSettings.mockResolvedValue({ apiToken: 'tok' });
      mockClient.query.mockResolvedValue({ me: [{ username: 'neonsolstice' }] });
      const result = await makeService().validateToken(1);
      expect(result).toEqual({ valid: true, hardcoverUsername: 'neonsolstice' });
    });

    it('strips Bearer prefix from inline token before querying', async () => {
      mockClient.query.mockResolvedValue({ me: [{ username: 'neonsolstice' }] });
      await makeService().validateToken(1, 'Bearer myrawtoken');
      expect(mockClient.query).toHaveBeenCalledWith(1, 'myrawtoken', expect.any(String));
    });

    it('strips Bearer prefix when saving via upsertSettings', async () => {
      mockRepo.findSettings.mockResolvedValue({ apiToken: 'existing' });
      mockRepo.upsertSettings.mockResolvedValue(undefined);
      await makeService().upsertSettings(1, { apiToken: 'Bearer myrawtoken' });
      expect(mockRepo.upsertSettings).toHaveBeenCalledWith(1, expect.objectContaining({ apiToken: 'myrawtoken' }));
    });

    it('returns invalid when query throws', async () => {
      mockRepo.findSettings.mockResolvedValue({ apiToken: 'tok' });
      mockClient.query.mockRejectedValue(new Error('Unauthorized'));
      const result = await makeService().validateToken(1);
      expect(result).toEqual({ valid: false });
    });

    it('returns invalid when me is empty array', async () => {
      mockRepo.findSettings.mockResolvedValue({ apiToken: 'tok' });
      mockClient.query.mockResolvedValue({ me: [] });
      const result = await makeService().validateToken(1);
      expect(result).toEqual({ valid: false });
    });
  });

  describe('getTokenForUser', () => {
    it('returns null when no settings', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      expect(await makeService().getTokenForUser(1)).toBeNull();
    });

    it('returns null when disabled', async () => {
      mockRepo.findSettings.mockResolvedValue({ apiToken: 'tok', enabled: false });
      expect(await makeService().getTokenForUser(1)).toBeNull();
    });

    it('returns token when enabled', async () => {
      mockRepo.findSettings.mockResolvedValue({ apiToken: 'tok', enabled: true });
      expect(await makeService().getTokenForUser(1)).toBe('tok');
    });
  });
});
