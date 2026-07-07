import { BadRequestException, NotFoundException } from '@nestjs/common';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import { StorygraphSettingsService } from './storygraph-settings.service';

const mockRepo = {
  findSettings: vi.fn(),
  userHasStorygraphSyncPermission: vi.fn(),
  upsertSettings: vi.fn(),
  deleteSettings: vi.fn(),
};

const mockClient = {
  get: vi.fn(),
};

function makeService() {
  return new StorygraphSettingsService(mockRepo as any, mockClient as any);
}

describe('StorygraphSettingsService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRepo.userHasStorygraphSyncPermission.mockResolvedValue(true);
  });

  describe('getSettings', () => {
    it('returns defaults when no settings row exists', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      const result = await makeService().getSettings(1);
      expect(result.cookiesConfigured).toBe(false);
      expect(result.enabled).toBe(false);
      expect(result.effectiveEnabled).toBe(false);
      expect(result.disabledReason).toBe('missing_cookies');
      expect(result.bookSyncMode).toBe('all_eligible');
    });

    it('returns settings without cookies when row exists', async () => {
      mockRepo.findSettings.mockResolvedValue({
        sessionCookie: 'sess',
        rememberToken: 'remember',
        enabled: true,
        autoSyncOnStatusChange: true,
        autoSyncOnProgressUpdate: false,
        bookSyncMode: 'selected_only',
        lastSyncedAt: null,
      });
      const result = await makeService().getSettings(1);
      expect(result.cookiesConfigured).toBe(true);
      expect(result.enabled).toBe(true);
      expect(result.effectiveEnabled).toBe(true);
      expect(result.disabledReason).toBeNull();
      expect(result.bookSyncMode).toBe('selected_only');
      expect(result.autoSyncOnProgressUpdate).toBe(false);
      expect((result as any).sessionCookie).toBeUndefined();
      expect((result as any).rememberToken).toBeUndefined();
      expect(result.lastSyncedAt).toBeNull();
    });

    it('returns user disabled effective state when configured sync is paused', async () => {
      mockRepo.findSettings.mockResolvedValue({
        sessionCookie: 'sess',
        rememberToken: 'remember',
        enabled: false,
        autoSyncOnStatusChange: true,
        autoSyncOnProgressUpdate: true,
        lastSyncedAt: null,
      });

      const result = await makeService().getSettings(1);

      expect(result.enabled).toBe(false);
      expect(result.effectiveEnabled).toBe(false);
      expect(result.disabledReason).toBe('user_disabled');
    });

    it('returns permission denied effective state when the user lacks StoryGraph sync permission', async () => {
      mockRepo.userHasStorygraphSyncPermission.mockResolvedValue(false);
      mockRepo.findSettings.mockResolvedValue({
        sessionCookie: 'sess',
        rememberToken: 'remember',
        enabled: true,
        autoSyncOnStatusChange: true,
        autoSyncOnProgressUpdate: true,
        lastSyncedAt: null,
      });

      const result = await makeService().getSettings(1);

      expect(result.effectiveEnabled).toBe(false);
      expect(result.disabledReason).toBe('permission_denied');
    });

    it('returns lastSyncedAt as ISO string when set', async () => {
      const syncedAt = new Date('2025-05-01T10:00:00Z');
      mockRepo.findSettings.mockResolvedValue({
        sessionCookie: 'sess',
        rememberToken: 'remember',
        enabled: true,
        autoSyncOnStatusChange: true,
        autoSyncOnProgressUpdate: true,
        lastSyncedAt: syncedAt,
      });
      const result = await makeService().getSettings(1);
      expect(result.lastSyncedAt).toBe(syncedAt.toISOString());
    });
  });

  describe('upsertSettings', () => {
    it('throws BadRequestException when saving without cookies and no existing row', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      await expect(makeService().upsertSettings(1, { enabled: true })).rejects.toThrow(BadRequestException);
    });

    it('throws BadRequestException when only one cookie value is provided and no existing row', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      await expect(makeService().upsertSettings(1, { sessionCookie: 'sess' })).rejects.toThrow(BadRequestException);
    });

    it('upserts and returns settings', async () => {
      mockRepo.findSettings.mockResolvedValueOnce(undefined).mockResolvedValue({
        sessionCookie: 'sess',
        rememberToken: 'remember',
        enabled: true,
        autoSyncOnStatusChange: true,
        autoSyncOnProgressUpdate: true,
      });
      mockRepo.upsertSettings.mockResolvedValue({});
      const result = await makeService().upsertSettings(1, { sessionCookie: 'sess', rememberToken: 'remember' });
      expect(result.cookiesConfigured).toBe(true);
      expect(mockRepo.upsertSettings).toHaveBeenCalledWith(1, { sessionCookie: 'sess', rememberToken: 'remember' });
    });

    it('carries existing cookies forward when updating settings without new values', async () => {
      const existing = {
        sessionCookie: 'saved-sess',
        rememberToken: 'saved-remember',
        enabled: true,
        autoSyncOnStatusChange: true,
        autoSyncOnProgressUpdate: true,
      };
      mockRepo.findSettings.mockResolvedValue(existing);
      mockRepo.upsertSettings.mockResolvedValue({});
      await makeService().upsertSettings(1, { enabled: false });
      expect(mockRepo.upsertSettings).toHaveBeenCalledWith(1, {
        sessionCookie: 'saved-sess',
        rememberToken: 'saved-remember',
        enabled: false,
      });
    });

    it('throws BadRequestException instead of overwriting stored cookies with empty strings', async () => {
      const existing = {
        sessionCookie: 'saved-sess',
        rememberToken: 'saved-remember',
        enabled: true,
        autoSyncOnStatusChange: true,
        autoSyncOnProgressUpdate: true,
      };
      mockRepo.findSettings.mockResolvedValue(existing);
      await expect(makeService().upsertSettings(1, { sessionCookie: '', rememberToken: '   ' })).rejects.toThrow(BadRequestException);
      await expect(makeService().upsertSettings(1, { sessionCookie: '  ', rememberToken: 'new-remember' })).rejects.toThrow(BadRequestException);
      expect(mockRepo.upsertSettings).not.toHaveBeenCalled();
    });

    it('saves a valid bookSyncMode', async () => {
      const existing = {
        sessionCookie: 'saved-sess',
        rememberToken: 'saved-remember',
        enabled: true,
        autoSyncOnStatusChange: true,
        autoSyncOnProgressUpdate: true,
      };
      mockRepo.findSettings.mockResolvedValue(existing);
      mockRepo.upsertSettings.mockResolvedValue({});
      await makeService().upsertSettings(1, { bookSyncMode: 'selected_only' });
      expect(mockRepo.upsertSettings).toHaveBeenCalledWith(1, {
        sessionCookie: 'saved-sess',
        rememberToken: 'saved-remember',
        bookSyncMode: 'selected_only',
      });
    });

    it('throws BadRequestException for invalid bookSyncMode', async () => {
      mockRepo.findSettings.mockResolvedValue({
        sessionCookie: 'saved-sess',
        rememberToken: 'saved-remember',
        enabled: true,
      });
      await expect(makeService().upsertSettings(1, { bookSyncMode: 'invalid' as never })).rejects.toThrow(BadRequestException);
    });
  });

  describe('disconnectUser', () => {
    it('throws NotFoundException when not configured', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      await expect(makeService().disconnectUser(1)).rejects.toThrow(NotFoundException);
    });

    it('deletes settings when configured', async () => {
      mockRepo.findSettings.mockResolvedValue({ sessionCookie: 'sess', rememberToken: 'remember' });
      mockRepo.deleteSettings.mockResolvedValue(undefined);
      await makeService().disconnectUser(1);
      expect(mockRepo.deleteSettings).toHaveBeenCalledWith(1);
    });
  });

  describe('validateCookies', () => {
    it('returns invalid when no settings and no inline cookies', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      expect(await makeService().validateCookies(1)).toEqual({ valid: false });
    });

    it('returns valid when the journal page loads without a sign-in redirect', async () => {
      mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false });
      const result = await makeService().validateCookies(1, 'sess', 'remember');
      expect(result).toEqual({ valid: true });
      expect(mockClient.get).toHaveBeenCalledWith(1, { sessionCookie: 'sess', rememberToken: 'remember' }, '/journal');
    });

    it('returns invalid when redirected to sign-in', async () => {
      mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: true });
      const result = await makeService().validateCookies(1, 'sess', 'remember');
      expect(result).toEqual({ valid: false });
    });

    it('uses stored cookies when no inline values are provided', async () => {
      mockRepo.findSettings.mockResolvedValue({ sessionCookie: 'stored-sess', rememberToken: 'stored-remember' });
      mockClient.get.mockResolvedValue({ status: 200, redirectedToSignIn: false });
      await makeService().validateCookies(1);
      expect(mockClient.get).toHaveBeenCalledWith(1, { sessionCookie: 'stored-sess', rememberToken: 'stored-remember' }, '/journal');
    });

    it('returns invalid when the request throws', async () => {
      mockClient.get.mockRejectedValue(new Error('network error'));
      const result = await makeService().validateCookies(1, 'sess', 'remember');
      expect(result).toEqual({ valid: false });
    });
  });

  describe('getCookiesForUser', () => {
    it('returns null when no settings', async () => {
      mockRepo.findSettings.mockResolvedValue(undefined);
      expect(await makeService().getCookiesForUser(1)).toBeNull();
    });

    it('returns null when the user lacks StoryGraph sync permission', async () => {
      mockRepo.userHasStorygraphSyncPermission.mockResolvedValue(false);
      mockRepo.findSettings.mockResolvedValue({ sessionCookie: 'sess', rememberToken: 'remember', enabled: true });
      expect(await makeService().getCookiesForUser(1)).toBeNull();
    });

    it('returns null when disabled', async () => {
      mockRepo.findSettings.mockResolvedValue({ sessionCookie: 'sess', rememberToken: 'remember', enabled: false });
      expect(await makeService().getCookiesForUser(1)).toBeNull();
    });

    it('returns cookies when enabled', async () => {
      mockRepo.findSettings.mockResolvedValue({ sessionCookie: 'sess', rememberToken: 'remember', enabled: true });
      expect(await makeService().getCookiesForUser(1)).toEqual({ sessionCookie: 'sess', rememberToken: 'remember' });
    });
  });
});
